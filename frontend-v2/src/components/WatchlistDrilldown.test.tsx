import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { WatchlistExplorer } from './WatchlistExplorer';
vi.mock('./SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const summary = { alerts: 20, cases: 10, active: 28, done: 2, overdue: 4, active_without_due_date: 10 };
const result = { data: [], total: 30, size: 25, page: 1, date_basis: '2026-11-24', summary };
const zero = { data: { ...result, total: 0, summary: Object.fromEntries(Object.keys(summary).map(key => [key, 0])) } };
function show(query = 'query=gateway&severity=high&sort=due') { render(<MemoryRouter initialEntries={['/app/watchlist?explore=1&' + query]}><WatchlistExplorer /></MemoryRouter>); }
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: result }); });afterEach(cleanup);
it('opens the exact full matching subset from page one, retaining applied criteria and replacing draft without writes', async () => {
 show(); await screen.findByText(/30 followed records match/); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' })); await screen.findByText(/page 2 of 2/); fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'discard this draft' } }); get.mockResolvedValueOnce(zero);
 fireEvent.click(screen.getByRole('button', { name: 'Explore active overdue records (utc): 4 matching records' }));
 await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { query: 'gateway', kind: 'all', severity: 'high', scope: 'overdue', sort: 'due', page: 1, size: 25 } }));
 expect(screen.getByLabelText('Search all watched records')).toHaveProperty('value', 'gateway'); expect(screen.getByLabelText('Full watchlist scope')).toHaveProperty('value', 'overdue'); await screen.findByText(/Opened active overdue/); expect(get).toHaveBeenCalledTimes(3);
});
it('preserves active due today while drilling into alerts and leaves incompatible scope counts noninteractive', async () => {
 get.mockResolvedValue({ data: { ...result, summary: { ...summary, active: 30, done: 0, overdue: 0, active_without_due_date: 0 } } }); show('scope=today'); await screen.findByText(/30 followed records match/);
 expect(screen.queryByRole('button', { name: /Explore active overdue/ })).toBeNull(); expect(screen.queryByRole('button', { name: /Explore completed/ })).toBeNull(); expect(screen.queryByRole('button', { name: /Explore active records without/ })).toBeNull();
 get.mockResolvedValueOnce(zero); fireEvent.click(screen.getByRole('button', { name: 'Explore followed alerts: 20 matching records' })); await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { query: '', kind: 'alert', severity: 'all', scope: 'today', sort: 'severity', page: 1, size: 25 } }));
});
it('never makes missing or inconsistent totals actionable', async () => { get.mockResolvedValueOnce({ data: { ...result, summary: { ...summary, active: 29 } } }); show(); await screen.findByText(/No totals were inferred/); expect(screen.queryByRole('button', { name: /^Explore / })).toBeNull(); });
it('ignores late old-scope results after an exact drilldown', async () => {
 let finish!: (value: unknown) => void; show(); await screen.findByText(/30 followed records match/); get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); fireEvent.click(screen.getByRole('button', { name: 'Explore followed alerts: 20 matching records' }));
 get.mockResolvedValueOnce(zero); fireEvent.change(screen.getByLabelText('Full watchlist type'), { target: { value: 'case' } }); await screen.findByText(/0 followed records match/); await act(async () => finish({ data: result })); expect(screen.queryByText(/30 followed records match/)).toBeNull(); expect(screen.getByLabelText('Full watchlist type')).toHaveProperty('value', 'case');
});
