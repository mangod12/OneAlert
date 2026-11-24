import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssignedTaskExplorer } from './AssignedTaskExplorer';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const stored = { query: 'saved gateway', severity: 'high', due: 'range', today: '2026-11-24', completion: 'all', investigations: 'inactive', dueFrom: '2026-11-20', dueThrough: '2026-11-24', investigationId: 7 };
let view: unknown = stored;
beforeEach(() => { vi.resetAllMocks(); view = stored; get.mockImplementation(async (url, config) => {
  if (url === '/cases/workload-views/') return { data: [{ id: 1, name: 'Fixed gateway', filters: view, created_at: '2026-11-24T00:00:00Z' }] };
  const p = config?.params as Record<string, string | number>;
  return { data: { data: [], total: p.page === 1 ? 30 : 26, page: p.page, size: 25, completion: p.completion, investigations: p.investigations, filter_date: p.today, ...(p.investigation_id ? { investigation_id: p.investigation_id } : {}), ...(p.due === 'range' ? { due_from: p.due_from, due_through: p.due_through } : {}) } };
}); });
afterEach(cleanup);
async function show() { render(<MemoryRouter><AssignedTaskExplorer /></MemoryRouter>); expect(get).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); await screen.findByText(/30 matching assigned/); await waitFor(() => expect(screen.getByRole('button', { name: 'Saved views' })).toBeTruthy()); }
it('saves only applied filters, not draft query/date/scope or page evidence', async () => {
  await show(); fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 2/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'unapplied secret draft' } });
  fireEvent.change(screen.getByLabelText('Full workload calendar date'), { target: { value: '2020-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'My current workload' } });
  post.mockResolvedValueOnce({ data: { id: 2, name: 'My current workload', filters: {} } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(post).toHaveBeenCalledWith('/cases/workload-views/', { name: 'My current workload', filters: { sort: 'priority', query: '', severity: 'all', due: 'all', today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), completion: 'open', investigations: 'active' } });
  expect(JSON.stringify(post.mock.calls)).not.toContain('unapplied'); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
it('applies exact saved criteria from page 1, replaces drafts and rechecks current server scope without task writes', async () => {
  await show(); fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 2/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'discard this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Fixed gateway' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: { query: stored.query, severity: 'high', due: 'range', today: stored.today, completion: 'all', investigations: 'inactive', due_from: stored.dueFrom, due_through: stored.dueThrough, investigation_id: 7, page: 1, size: 25 } }));
  expect(screen.getByLabelText('Search full assigned workload')).toHaveProperty('value', stored.query); expect(screen.getByLabelText('Full workload calendar date')).toHaveProperty('value', stored.today);
  expect(screen.getByText(/Applied investigation #7 only/)).toBeTruthy(); expect(screen.getByText(/Views are private to your account/)).toBeTruthy(); expect(post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
});
it('invalid saved criteria leave applied filters, draft edits and current results unchanged', async () => {
  view = { ...stored, today: 'not-a-date' }; await show(); fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'keep draft' } }); const calls = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Fixed gateway' }));
  expect(screen.getByText(/Saved workload view is invalid/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(calls); expect(screen.getByLabelText('Search full assigned workload')).toHaveProperty('value', 'keep draft'); expect(screen.getByText(/30 matching assigned/)).toBeTruthy();
});
