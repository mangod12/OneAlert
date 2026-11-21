import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SearchWorkspace } from './SearchWorkspace';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const rows = {
  alerts: { id: 81, title: 'Gateway alert beyond preview', severity: 'high', status: 'pending' },
  cases: { id: 71, title: 'Gateway investigation', severity: 'high', status: 'open' },
  assets: { id: 61, name: 'Gateway asset', vendor: null, asset_type: 'hardware' },
  events: { id: 51, signature: 'Gateway signature', event_type: 'alert', severity: 'high', timestamp: '2026-11-21T00:00:00Z', source_ip: null, dest_ip: null },
  incidents: { asset_id: 61, asset_name: 'Gateway incident', max_severity: 'critical', alert_count: 4 },
};
function response(params: Record<string, unknown>) { const kind = params.kind as keyof typeof rows; return { data: { query: params.q, kind, page: params.page, size: 20, total: 23, totals: { alerts: 23, cases: 23, assets: 23, events: 23, incidents: 23 }, retrieved_at: '2026-11-21T00:00:00Z', records: [rows[kind]] } }; }
function show(url = '/search?q=gateway') { return render(<MemoryRouter initialEntries={[url]}><SearchWorkspace /></MemoryRouter>); }
beforeEach(() => { get.mockReset(); get.mockImplementation(async (_url, options) => response(options?.params as Record<string, unknown>)); });
afterEach(cleanup);
it('reads the complete matching scope and pages beyond palette previews', async () => {
  show(); await screen.findByText('#81: Gateway alert beyond preview');
  expect(screen.getByRole('link')).toHaveAttribute('href', '/alerts?alert=81');
  expect(screen.getByRole('button', { name: 'Alerts (23)' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Next search page' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/search/records', { params: { q: 'gateway', kind: 'alerts', page: 2, size: 20 } }));
  expect(await screen.findByText(/Page 2 of 2/)).toBeInTheDocument();
});
it.each([
  ['Investigations', '/cases/71'], ['Assets', '/assets?asset=61'],
  ['Saved events', '/events/51'], ['Incidents', '/incidents?asset_id=61'],
])('opens exact %s destinations', async (label, href) => {
  show(); await screen.findByText('#81: Gateway alert beyond preview');
  fireEvent.click(screen.getByRole('button', { name: `${label} (23)` }));
  await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', href));
});
it('keeps draft text separate, disables page/type switches and applies from page one', async () => {
  show('/search?q=gateway&page=2'); await screen.findByText('#81: Gateway alert beyond preview');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pump 100%_' } });
  expect(screen.getByText(/Query draft not applied/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Assets (23)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Search all records' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/search/records', { params: { q: 'pump 100%_', kind: 'alerts', page: 1, size: 20 } }));
});
it.each(['/search?q=one&q=two', '/search?q=gateway&kind=constructor', '/search?q=gateway&page=-2', '/search?q=gateway&page=1&page=2', '/search?q=gateway&kind=events&kind=alerts'])('blocks malformed scope %s', async url => {
  show(url); expect(screen.getByRole('alert')).toHaveTextContent('No record search was made');
  expect(get).not.toHaveBeenCalled();
});
it('requires two non-padding characters', () => { show('/search?q=x'); expect(get).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Search all records' })).toBeDisabled(); });
it('does not turn a denied read into no matches and supports retry', async () => {
  get.mockRejectedValueOnce(new Error('Denied'));
  show(); expect(await screen.findByRole('alert')).toHaveTextContent('counts and absence of records are unknown');
  fireEvent.click(screen.getByRole('button', { name: 'Retry full workspace search' }));
  expect(await screen.findByText('#81: Gateway alert beyond preview')).toBeInTheDocument();
});
it('rejects wrong query and totals instead of showing stale records', async () => {
  get.mockImplementation(async (_url, options) => { const value = response(options?.params as Record<string, unknown>); value.data.query = 'other query'; return value; });
  show(); expect(await screen.findByRole('alert')).toHaveTextContent('did not match'); expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('offers a return path for an empty later page without inferring no global matches', async () => {
  get.mockImplementation(async (_url, options) => { const value = response(options?.params as Record<string, unknown>); value.data.records = []; return value; });
  show('/search?q=gateway&page=4'); await screen.findByText(/No records on this page/);
  fireEvent.click(screen.getByRole('button', { name: 'Return to first search page' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/search/records', { params: { q: 'gateway', kind: 'alerts', page: 1, size: 20 } }));
});
