import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssignedTaskExplorer } from './AssignedTaskExplorer';
import { workloadSearchLink } from '../utils/assignedWorkloadLink';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('./SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
const get = vi.mocked(apiClient.get), writeText = vi.fn();
const filters = { query: 'gateway + π & 100%_', severity: 'high', due: 'range', today: '2026-11-24', completion: 'all', investigations: 'inactive', dueFrom: '2026-11-20', dueThrough: '2026-11-24', investigationId: 7, sort: 'completed_newest' };
const params = { query: filters.query, severity: 'high', due: 'range', today: filters.today, completion: 'all', investigations: 'inactive', due_from: filters.dueFrom, due_through: filters.dueThrough, investigation_id: 7, sort: 'completed_newest', page: 1, size: 25 };
function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate(workloadSearchLink(window.location.origin, { ...filters, query: 'new' }).replace(window.location.origin, ''))}>Different workload link</button>; }
function show(query = new URL(workloadSearchLink(window.location.origin, filters)).search) { render(<MemoryRouter initialEntries={['/app/my-tasks' + query]}><AssignedTaskExplorer /><Navigation /></MemoryRouter>); }
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); writeText.mockResolvedValue(undefined); get.mockImplementation(async (_url, config) => { const p = config?.params as typeof params; return { data: { data: [], total: 30, page: p.page, size: 25, completion: p.completion, investigations: p.investigations, filter_date: p.today, sort: p.sort, investigation_id: p.investigation_id, due_from: p.due_from, due_through: p.due_through } }; }); });
afterEach(cleanup);
it('opens exact linked criteria at page one under current account and fixed dates', async () => { show(); await screen.findByText(/30 matching assigned/); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/assigned-task-explorer', { params }); expect(screen.getByLabelText('Search full assigned workload')).toHaveProperty('value', filters.query); expect(screen.getByText(/Each viewer sees only their own current assigned records/)).toBeTruthy(); });
it('copies applied criteria only, not drafts, page, unrelated URL data or record evidence', async () => {
  show(new URL(workloadSearchLink(window.location.origin, filters)).search + '&private=omit'); await screen.findByText(/30 matching/); fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 2/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'do not copy draft' } }); fireEvent.change(screen.getByLabelText('Full workload sort'), { target: { value: 'title' } }); fireEvent.click(screen.getByRole('button', { name: 'Copy applied workload search link' })); await screen.findByText(/Applied workload search link copied/);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(workloadSearchLink(window.location.origin, filters)); expect(get).toHaveBeenCalledTimes(2);
});
it.each(['?workload=0', '?workload=1&query=a&query=b', '?workload=1&today=2026-02-30'])('blocks malformed links without a broad fallback query and permits explicit valid recovery %s', async query => {
  show(query); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Copy applied workload search link' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Refresh full workload page' })); expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' })); await screen.findByText(/30 matching/); expect(get).toHaveBeenCalledOnce();
});
it('ignores stale results after same-page link navigation', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); show(); fireEvent.click(screen.getByText('Different workload link')); await screen.findByText(/30 matching/); expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: { ...params, query: 'new' } });
  await act(async () => finish({ data: { data: [{ title: 'old secret result' }], total: 1 } })); expect(screen.queryByText('old secret result')).toBeNull();
});
it('reports clipboard refusal without altering filters', async () => { writeText.mockRejectedValueOnce(new Error('denied')); show(); await screen.findByText(/30 matching/); fireEvent.click(screen.getByRole('button', { name: 'Copy applied workload search link' })); await screen.findByText('Copy unavailable. Applied workload filters are unchanged.'); expect(get).toHaveBeenCalledOnce(); });
it('does not confirm old clipboard operation after applying changed criteria', async () => {
  let finish!: () => void; writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })); show(); await screen.findByText(/30 matching/); fireEvent.click(screen.getByRole('button', { name: 'Copy applied workload search link' })); fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'new filters' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' })); await waitFor(() => expect(get).toHaveBeenCalledTimes(2)); await act(async () => finish()); expect(screen.queryByText(/Applied workload search link copied/)).toBeNull();
});
