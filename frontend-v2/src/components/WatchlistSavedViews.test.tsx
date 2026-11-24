import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { WatchlistExplorer } from './WatchlistExplorer';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const filters = { query: 'gateway', kind: 'case', severity: 'high', scope: 'overdue', sort: 'due' };
let stored: unknown = filters;
beforeEach(() => { vi.resetAllMocks(); stored = filters; get.mockImplementation(async (url, config) => {
  if (url === '/cases/watchlist-views/') return { data: [{ id: 1, name: 'Overdue gateway', filters: stored, created_at: '2026-11-24T00:00:00Z' }] };
  const p = config?.params as Record<string, unknown>; return { data: { data: [], total: 30, page: p.page, size: 25, date_basis: '2026-11-24' } };
}); });
afterEach(cleanup);
async function show(query = '') { render(<MemoryRouter initialEntries={['/watchlist' + query]}><WatchlistExplorer /></MemoryRouter>); await screen.findByText(/30 followed records match/); }
it('saves applied filters only and excludes unsubmitted search draft and current page', async () => {
  await show(); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' })); await screen.findByText(/page 2 of 2/); fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'do not save draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'Applied only' } }); post.mockResolvedValueOnce({ data: { id: 2, name: 'Applied only', filters: {} } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith('/cases/watchlist-views/', { name: 'Applied only', filters: { query: '', kind: 'all', severity: 'all', scope: 'all', sort: 'severity' } })); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
it('restores page one, replaces draft, fetches current followed scope and shows UTC-date caveat', async () => {
  await show(); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' })); await screen.findByText(/page 2 of 2/); fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'replace draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Overdue gateway' })); await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { ...filters, page: 1, size: 25 } }));
  expect(screen.getByLabelText('Search all watched records')).toHaveProperty('value', 'gateway'); expect(screen.getByText(/Due scopes are recalculated/)).toBeTruthy(); expect(post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
});
it('refuses invalid saved data without changing the existing draft or applied results', async () => {
  stored = { ...filters, watcher_ids: [7] }; await show(); fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'keep draft' } }); const count = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Overdue gateway' })); expect(get).toHaveBeenCalledTimes(count); expect(screen.getByLabelText('Search all watched records')).toHaveProperty('value', 'keep draft'); expect(screen.getByText(/Saved watchlist view is invalid/)).toBeTruthy();
});

it.each(['today', 'future', 'undated'])('restores %s with current UTC scope and resets pagination without a subscription write', async scope => {
  stored = { ...filters, scope }; await show(); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' })); await screen.findByText(/page 2 of 2/);
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Overdue gateway' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { ...filters, scope, page: 1, size: 25 } }));
  expect(screen.getByLabelText('Full watchlist scope')).toHaveProperty('value', scope); expect(post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
