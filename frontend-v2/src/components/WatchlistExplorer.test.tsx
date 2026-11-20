import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { WatchlistExplorer } from './WatchlistExplorer';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const lastParams = () => get.mock.calls.at(-1)?.[1]?.params as Record<string, unknown>;
const row = { id: 1, kind: 'alert', title: 'Followed gateway', cve_id: 'CVE-2099-0001', asset_name: 'Gateway 1', severity: 'critical', status: 'pending', created_at: '2026-01-01T00:00:00Z', due_date: '2026-01-03' };
const result = (data: unknown[] = [row], total = 268) => ({ data, total, page: 1, size: 25, date_basis: '2026-11-21' });
const mount = () => render(<MemoryRouter><WatchlistExplorer /></MemoryRouter>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => get.mockResolvedValue({ data: result() }));
it('asks for bounded complete follow-only query and links exact alert and investigation IDs', async () => {
  get.mockResolvedValue({ data: result([row, { ...row, kind: 'case', title: 'Followed investigation' }]) }); mount();
  expect((await screen.findByRole('link', { name: 'Followed gateway' })).getAttribute('href')).toBe('/alerts?alert=1');
  expect(screen.getByRole('link', { name: 'Followed investigation' }).getAttribute('href')).toBe('/cases/1');
  expect(screen.getByText(/268 followed records match across your entire watchlist/)).toBeTruthy();
  expect(get).toHaveBeenCalledWith('/cases/watched-record-explorer', { params: { page: 1, size: 25, query: '', kind: 'all', severity: 'all', scope: 'all', sort: 'severity' } });
});
it('keeps draft separate and applies trimmed search from page one', async () => {
  mount(); await screen.findByRole('link'); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' }));
  await waitFor(() => expect(lastParams().page).toBe(2)); await screen.findByRole('link');
  fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: '  gateway  ' } });
  expect(screen.getByText(/Search draft not applied/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Search all followed records' }));
  await waitFor(() => expect(lastParams()).toMatchObject({ page: 1, query: 'gateway' }));
});
it.each([['Full watchlist type', 'case', 'kind'], ['Full watchlist severity', 'high', 'severity'], ['Full watchlist scope', 'overdue', 'scope'], ['Full watchlist order', 'due', 'sort']])('applies %s across the full query and resets page', async (label, value, key) => {
  mount(); await screen.findByRole('link'); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' })); await screen.findByRole('link');
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await waitFor(() => expect(lastParams()).toMatchObject({ page: 1, [key]: value }));
});
it('drops old page rows while fetching and ignores an older request after filters change', async () => {
  let old!: (value: {data: unknown}) => void; get.mockReturnValueOnce(new Promise(resolve => { old = resolve; })); mount();
  fireEvent.change(screen.getByLabelText('Full watchlist type'), { target: { value: 'case' } });
  await screen.findByRole('link', { name: 'Followed gateway' });
  old({ data: result([{ ...row, title: 'Stale record' }]) });
  await waitFor(() => expect(screen.queryByText('Stale record')).not.toBeTruthy());
  get.mockReturnValueOnce(new Promise(() => {})); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' }));
  expect(screen.queryByRole('link')).not.toBeTruthy(); expect(screen.getByText('Searching all followed records...')).toBeTruthy();
});
it('recovers a failed filtered query without silently returning to the unfiltered watchlist', async () => {
  mount(); await screen.findByRole('link'); get.mockRejectedValueOnce(new Error('Unavailable'));
  fireEvent.change(screen.getByLabelText('Full watchlist scope'), { target: { value: 'done' } }); await screen.findByRole('alert');
  expect(screen.queryByRole('link')).not.toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Retry full watchlist search' })); await screen.findByRole('link');
  expect(lastParams().scope).toBe('done');
});
it('clears filters and refreshes without discarding a new query draft unexpectedly', async () => {
  mount(); await screen.findByRole('link'); fireEvent.change(screen.getByLabelText('Full watchlist type'), { target: { value: 'alert' } }); await screen.findByRole('link');
  fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh full watchlist results' })); await screen.findByRole('link');
  expect((screen.getByLabelText('Search all watched records') as HTMLInputElement).value).toBe('draft'); expect(lastParams().kind).toBe('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Clear full watchlist filters' })); await screen.findByRole('link');
  expect((screen.getByLabelText('Search all watched records') as HTMLInputElement).value).toBe(''); expect(lastParams().kind).toBe('all');
});
it('offers first-page recovery if external unwatching leaves a page empty', async () => {
  mount(); await screen.findByRole('link'); get.mockResolvedValueOnce({ data: result([], 0) }); fireEvent.click(screen.getByRole('button', { name: 'Next watched page' }));
  await screen.findByText(/Records may have moved/); expect((screen.getByRole('button', { name: 'Next watched page' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'First watched page' })); await screen.findByRole('link'); expect(lastParams().page).toBe(1);
});
it('labels missing metadata and empty first page without claiming a full history', async () => {
  get.mockResolvedValueOnce({ data: result([{ ...row, due_date: null, created_at: null, severity: null, status: null, cve_id: null, asset_name: null }], 1) });
  mount(); await screen.findByRole('link'); expect(within(screen.getByRole('list', { name: 'Full watchlist results' })).getByText(/Severity not recorded/)).toBeTruthy();
  expect(screen.getByText(/No date recorded/)).toBeTruthy(); expect(screen.getByText(/not an atomic snapshot or watch history/)).toBeTruthy();
  get.mockResolvedValueOnce({ data: result([], 0) }); fireEvent.click(screen.getByRole('button', { name: 'Refresh full watchlist results' })); await screen.findByText(/Try other filters/);
});
