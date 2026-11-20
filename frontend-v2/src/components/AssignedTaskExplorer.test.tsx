import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssignedTaskExplorer } from './AssignedTaskExplorer';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const task = { task_id: 209, case_id: 7, title: 'Collect late-page evidence', case_title: 'Gateway investigation', case_severity: 'high', case_status: 'open', due_date: '2026-11-20', case_due_date: null };
const result = (page = 1, total = 201) => ({ data: [task], total, page, size: 25, filter_date: new Date().toLocaleDateString('en-CA') });
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (_url, config) => ({ data: { ...result((config?.params as { page: number }).page), filter_date: (config?.params as { today: string }).today } })); });
afterEach(cleanup);
function show() { render(<MemoryRouter><AssignedTaskExplorer /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); }
it('loads only on demand and reaches records beyond the editing cap with stable server pages', async () => {
  render(<MemoryRouter><AssignedTaskExplorer /></MemoryRouter>); expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' }));
  await screen.findByText(/201 matching assigned task records/);
  expect(screen.getByRole('link', { name: /Gateway investigation/ }).getAttribute('href')).toBe('/cases/7');
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' }));
  await screen.findByText(/Page 2 of 9/); expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ page: 2, size: 25 }) });
});
it('keeps edits separate until apply and sends global filter criteria with explicit calendar date', async () => {
  show(); await screen.findByText(/201 matching/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'Late-page' } });
  fireEvent.change(screen.getByLabelText('Full workload due filter'), { target: { value: 'overdue' } });
  fireEvent.change(screen.getByLabelText('Full workload calendar date'), { target: { value: '2026-11-21' } });
  expect(get).toHaveBeenCalledTimes(1); expect(screen.getByText(/Filter edits are not applied/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: { query: 'Late-page', due: 'overdue', severity: 'all', today: '2026-11-21', page: 1, size: 25 } }));
});
it('does not turn a failed response into an empty-workload claim and retries', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); show(); await screen.findByRole('alert');
  expect(screen.queryByText(/No assigned tasks match/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh full workload page' })); await screen.findByText(/201 matching/);
});
it('rejects mismatched page and date responses', async () => {
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(2), filter_date: (config?.params as { today: string }).today } }));
  show(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
  get.mockResolvedValueOnce({ data: { ...result(), filter_date: '2000-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh full workload page' })); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('ignores a late result after closing the explorer', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  show(); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' }));
  await act(async () => finish({ data: result() })); expect(screen.queryByRole('link')).toBeNull();
});
it('recovers the last server page when remaining tasks disappear', async () => {
  show(); await screen.findByText(/201 matching/);
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(2, 1), data: [], filter_date: (config?.params as { today: string }).today } }));
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ page: 1 }) }));
});

it('rejects invalid task identities without showing links', async () => {
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), data: [{ ...task, task_id: 0 }], filter_date: (config?.params as { today: string }).today } }));
  show(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
