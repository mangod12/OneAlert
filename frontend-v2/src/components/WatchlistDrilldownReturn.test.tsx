import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { WatchlistExplorer } from './WatchlistExplorer';
vi.mock('./SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const summary = { alerts: 20, cases: 10, active: 28, done: 2, overdue: 4, active_without_due_date: 10 };
const result = { data: [], total: 30, size: 25, page: 1, date_basis: '2026-11-24', summary };
const restore = 'Return to search before last workload drilldown';
const base = { query: 'gateway', kind: 'all', severity: 'high', scope: 'all', sort: 'due' };
async function show() { render(<MemoryRouter initialEntries={['/app/watchlist?explore=1&query=gateway&severity=high&sort=due']}><WatchlistExplorer /></MemoryRouter>); await screen.findByText(/30 followed records match/); }
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: result }); });afterEach(cleanup);
it('restores exact prior applied criteria and page while preserving a separate unapplied draft', async () => {
 await show();fireEvent.click(screen.getByRole('button', { name: 'Next watched page' }));await screen.findByText(/page 2 of 2/);fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'unsubmitted draft' } });
 fireEvent.click(screen.getByRole('button', { name: 'Explore followed alerts: 20 matching records' }));await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { ...base, kind: 'alert', page: 1, size: 25 } }));
 fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'later draft to replace' } });fireEvent.click(screen.getByRole('button', { name: restore }));
 await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { ...base, page: 2, size: 25 } }));expect(screen.getByLabelText('Search all watched records')).toHaveProperty('value', 'unsubmitted draft');expect(screen.getByText(/Search draft not applied/)).toBeTruthy();expect(screen.queryByRole('button', { name: restore })).toBeNull();expect(get).toHaveBeenCalledTimes(4);
});
it('keeps only the immediately preceding drilldown and returns once, not replaying old results', async () => {
 await show();get.mockResolvedValueOnce({ data: { ...result, total: 20, summary: { ...summary, alerts: 20, cases: 0, active: 18 } } });fireEvent.click(screen.getByRole('button', { name: 'Explore followed alerts: 20 matching records' }));await screen.findByRole('button', { name: 'Explore active overdue records (utc): 4 matching records' });
 fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'second draft' } });fireEvent.click(screen.getByRole('button', { name: 'Explore active overdue records (utc): 4 matching records' }));await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
 get.mockResolvedValueOnce({ data: { ...result, total: 0, data: [], summary: Object.fromEntries(Object.keys(summary).map(key => [key, 0])), date_basis: '2026-11-25' } });fireEvent.click(screen.getByRole('button', { name: restore }));await screen.findByText(/0 followed records match/);
 expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { ...base, kind: 'alert', page: 1, size: 25 } });expect(screen.getByLabelText('Search all watched records')).toHaveProperty('value', 'second draft');expect(screen.getByText(/UTC date basis: 2026-11-25/)).toBeTruthy();expect(screen.queryByRole('button', { name: restore })).toBeNull();
});
it('keeps the return point usable after a failed narrowed search', async () => {
 await show();get.mockRejectedValueOnce(new Error('Offline'));fireEvent.click(screen.getByRole('button', { name: 'Explore followed alerts: 20 matching records' }));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button', { name: restore }));await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { ...base, page: 1, size: 25 } }));await screen.findByText(/30 followed records match/);
});
