import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { WatchlistExplorer } from './WatchlistExplorer';
vi.mock('./SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const summary = { alerts: 134, cases: 134, active: 266, done: 2, overdue: 2, active_without_due_date: 264 };
const result = { data: [{ id: 1, kind: 'alert', title: 'Single loaded row' }], total: 268, page: 1, size: 25, date_basis: '2026-11-21', summary };
const mount = () => render(<MemoryRouter><WatchlistExplorer /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: result }); }); afterEach(cleanup);
it('shows full filtered workload counts rather than counting loaded rows', async () => {
  mount(); const panel = await screen.findByRole('region', { name: 'Full matching watchlist workload' });
  expect(within(panel).getByText(/not the 1 visible rows/)).toBeTruthy(); expect(within(panel).getByText('266')).toBeTruthy(); expect(within(panel).getByText('264')).toBeTruthy(); expect(within(panel).getByText(/Missing due dates are not counted as overdue/)).toBeTruthy();
});
it.each([undefined, { ...summary, cases: 133 }, { ...summary, active: 267 }, { ...summary, overdue: 267 }, { ...summary, active_without_due_date: 266 }, { ...summary, alerts: -1 }, { ...summary, done: 1.5 }, {}])('does not infer totals when missing or internally inconsistent %#', async bad => {
  get.mockResolvedValueOnce({ data: { ...result, summary: bad } }); mount(); await screen.findByText(/No totals were inferred/); expect(screen.queryByText('266')).toBeNull(); expect(screen.getByRole('link', { name: 'Single loaded row' })).toBeTruthy();
});
it('clears old totals while a new filter is pending then displays zero explicitly', async () => {
  mount(); await screen.findByText('266'); let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); fireEvent.change(screen.getByLabelText('Full watchlist scope'), { target: { value: 'overdue' } });
  expect(screen.queryByText('266')).toBeNull(); finish({ data: { ...result, total: 0, data: [], summary: Object.fromEntries(Object.keys(summary).map(key => [key, 0])) } }); const panel = await screen.findByRole('region', { name: 'Full matching watchlist workload' }); expect(within(panel).getAllByText('0')).toHaveLength(6);
});

it('rejects totals that contradict the applied work scope or record type', async () => {
  mount(); await screen.findByText('266'); fireEvent.change(screen.getByLabelText('Full watchlist scope'), { target: { value: 'overdue' } }); await screen.findByText(/No totals were inferred/);
});
