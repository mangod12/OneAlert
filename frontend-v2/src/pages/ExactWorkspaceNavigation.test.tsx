import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Assets } from './Assets';
import { Incidents } from './Incidents';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const asset = { id: 71, name: 'Same asset name', asset_type: 'hardware', vendor: 'Example', product: 'Gateway', is_ot_asset: false, created_at: '2026-11-20T00:00:00Z', risk_score: 0 };
const incident = { asset_id: 71, asset_name: 'Same asset name', asset_vendor: 'Example', asset_product: 'Gateway', max_severity: 'critical', alert_count: 2, shared_cves: [], first_seen: null, last_seen: null, blast_radius: 0, linked_cases: [], alerts: [] };
function Probe() { const location = useLocation(), navigate = useNavigate(); return <><span data-testid="location">{location.pathname}{location.search}</span><button onClick={() => navigate('/assets?asset=72')}>Other asset link</button><button onClick={() => navigate('/incidents?asset_id=72')}>Other incident link</button></>; }
const mount = (path: string, page: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{page}<Probe /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => {
  if (url === '/assets/') return { data: { assets: [], total: 0 } };
  if (url === '/assets/71') return { data: asset };
  if (url === '/assets/72') return { data: { ...asset, id: 72, name: 'Other exact asset' } };
  if (url === '/incidents') return { data: { incidents: [incident], total: 1 } };
  if (/^\/incidents\/\d+\/timeline$/.test(url)) return { data: { events: [], total: 0, kinds: [] } };
  return { data: [] };
}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('opens an exact asset outside current inventory pages and preserves unrelated URL filters on close', async () => {
  mount('/assets?search=elsewhere&asset=71&keep=yes', <Assets />);
  const dialog = await screen.findByRole('dialog'); expect(await within(dialog).findByText('Same asset name')).toBeTruthy();
  expect(get).toHaveBeenCalledWith('/assets/71'); expect(within(dialog).getByText('IT / other')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close details' })); expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTestId('location').textContent).toBe('/assets?search=elsewhere&keep=yes');
});
it.each(['asset=0', 'asset=-1', 'asset=1.5', 'asset=NaN', 'asset=9007199254740992', 'asset=71&asset=72', 'asset='])('rejects invalid asset link %s without reading an exact record', async query => {
  mount(`/assets?${query}`, <Assets />); await screen.findByText(/This asset record link is invalid/);
  expect(get.mock.calls.some(([url]) => /^\/assets\/\d+$/.test(url))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Clear invalid asset record link' })); expect(screen.queryByRole('dialog')).toBeNull();
});
it('responds to a new same-page exact asset URL without relying on the initial name filter', async () => {
  mount('/assets?asset=71', <Assets />); await screen.findByText('Same asset name'); fireEvent.click(screen.getByText('Other asset link'));
  await screen.findByText('Other exact asset'); expect(screen.queryByText('Same asset name')).toBeNull();
});
it('copies only the exact asset locator and states access and freshness limits', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.history.replaceState({}, '', '/app/assets?search=private&asset=71#details');
  mount('/assets?asset=71', <Assets />); const dialog = await screen.findByRole('dialog'); await within(dialog).findByText('Same asset name');
  fireEvent.click(screen.getByRole('button', { name: 'Copy asset record link' })); await screen.findByText('Asset record link copied.');
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/assets?asset=71`); expect(screen.getByText(/This link does not grant access/)).toBeTruthy();
});
it('opens and expands exact current incident and links the correct inventory record', async () => {
  mount('/incidents?asset_id=71', <Incidents />); await screen.findByText('Same asset name');
  expect(get).toHaveBeenCalledWith('/incidents', { params: { asset_id: '71' } });
  expect(screen.getByRole('link', { name: 'Open exact asset inventory record' }).getAttribute('href')).toBe('/assets?asset=71');
  expect(screen.getByText(/not an immutable incident ID/)).toBeTruthy(); expect(screen.queryByLabelText('Minimum severity')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Return to filtered incident list' })); await waitFor(() => expect(get).toHaveBeenCalledWith('/incidents', { params: {} }));
});
it.each(['asset_id=0', 'asset_id=71&asset_id=72', 'asset_id=nope'])('rejects invalid incident link %s without a fallback broad query', async query => {
  mount(`/incidents?${query}`, <Incidents />); await screen.findByText('Invalid incident record link'); expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear invalid incident link' })); await screen.findByText('Same asset name');
});
it('does not substitute another incident when the exact reply identity is wrong', async () => {
  mount('/incidents?asset_id=72', <Incidents />); await screen.findByRole('alert'); expect(screen.queryByText('Same asset name')).toBeNull();
});
it('explains disappearance of a computed incident without asserting resolution', async () => {
  get.mockResolvedValue({ data: { incidents: [], total: 0 } }); mount('/incidents?asset_id=71', <Incidents />);
  await screen.findByText(/No qualifying current incident is visible/); expect(screen.getByText(/No resolution or historical state is inferred/)).toBeTruthy();
});
it('ignores an older exact incident read after a different same-page link arrives', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  mount('/incidents?asset_id=71', <Incidents />); get.mockResolvedValueOnce({ data: { incidents: [{ ...incident, asset_id: 72, asset_name: 'New exact incident' }], total: 1 } });
  fireEvent.click(screen.getByText('Other incident link')); await screen.findByText('New exact incident');
  await act(async () => { resolve({ data: { incidents: [incident], total: 1 } }); }); expect(screen.queryByText('Same asset name')).toBeNull();
});
it('copies a current incident locator without carrying a draft text query or hash', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.history.replaceState({}, '', '/app/incidents?asset=private#details'); mount('/incidents?asset_id=71', <Incidents />); await screen.findByText('Same asset name');
  fireEvent.click(screen.getByRole('button', { name: 'Copy current incident link' })); await screen.findByText('Current incident link copied.');
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/incidents?asset_id=71`);
});
it('shows clipboard failure without claiming an asset or incident link was copied', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
  mount('/assets?asset=71', <Assets />); await screen.findByText('Same asset name'); fireEvent.click(screen.getByRole('button', { name: 'Copy asset record link' })); await screen.findByText(/The link could not be copied/); expect(screen.queryByText('Asset record link copied.')).toBeNull();
});
