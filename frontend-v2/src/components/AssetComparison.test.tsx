import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssetComparison } from './AssetComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const first = { id: 7, name: 'Gateway', asset_type: 'hardware', vendor: 'Vendor', product: 'Device', created_at: '2026-11-20T18:00:00Z', is_ot_asset: false, risk_score: 0 };
const second = { ...first, id: 29, firmware_version: '2.0', network_zone: 'plant', risk_score: 65, is_ot_asset: true };
function show(ids = [7, 29], revision = 0) { return render(<MemoryRouter><AssetComparison ids={ids} revision={revision} /></MemoryRouter>); }
function load() { fireEvent.click(screen.getByRole('button', { name: 'Load selected asset comparison' })); }
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => ({ data: url.endsWith('/7') ? first : second })); });
afterEach(cleanup);
it('compares exact reloaded records only on request, preserving false, zero and missing metadata', async () => {
  show(); expect(get).not.toHaveBeenCalled(); load(); await screen.findByText(/4 of 23 shown inventory fields differ/);
  expect(get.mock.calls.map(call => call[0])).toEqual(['/assets/7', '/assets/29']);
  expect(screen.getByText('false')).toBeTruthy(); expect(screen.getByText('true')).toBeTruthy(); expect(screen.getByText('0')).toBeTruthy(); expect(screen.getByText('65')).toBeTruthy();
  expect(screen.getAllByText('(field not returned)')).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Review alerts for asset #29' }).getAttribute('href')).toBe('/alerts?asset_id=29');
  expect(screen.getByText(/not an atomic snapshot/)).toBeTruthy();
});
it('supports display search and field pages without extra requests', async () => {
  show(); load(); await screen.findByText(/4 of 23 shown inventory fields differ/);
  fireEvent.click(screen.getByLabelText('Differing inventory fields only')); expect(screen.getByText(/Page 1 of 3/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'More compared fields' })); expect(screen.getByText(/Page 2 of 3/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search asset comparison'), { target: { value: 'firmware' } }); expect(screen.getByText(/Page 1 of 1/)).toBeTruthy();
  expect(screen.getByText('Firmware version · Different recorded values')).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2);
});
it('keeps null and empty text distinct and avoids device-equivalence claims', async () => {
  get.mockResolvedValueOnce({ data: { ...first, description: null } }).mockResolvedValueOnce({ data: { ...first, id: 29, description: '' } });
  show(); load(); await screen.findByText(/1 of 23 shown inventory fields differ/);
  expect(screen.getByText('(null: not recorded)')).toBeTruthy(); expect(screen.getByText('(empty text)')).toBeTruthy();
});
it('does not infer equivalent devices or equal risk from identical shown values', async () => {
  get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: { ...first, id: 29 } }); show(); load(); await screen.findByText(/does not establish equivalent devices or equal operational risk/);
});
it.each([{ id: 99 }, { risk_score: '65' }, { is_ot_asset: 'true' }, { product: null }])('rejects invalid comparison evidence %j', async override => {
  get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: { ...second, ...override } }); show(); load(); await screen.findByRole('alert'); expect(screen.queryByText(/of 23 shown inventory fields differ/)).toBeNull();
});
it('clears saved comparison evidence after local mutation revision or changed selection', async () => {
  const view = show(); load(); await screen.findByText(/of 23 shown inventory fields differ/);
  view.rerender(<MemoryRouter><AssetComparison ids={[7, 29]} revision={1} /></MemoryRouter>); expect(screen.queryByText(/of 23 shown inventory fields differ/)).toBeNull();
  expect(get).toHaveBeenCalledTimes(2);
});
it('does not claim equality after unavailable reads and can reload', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); show(); load(); await screen.findByRole('alert'); expect(screen.queryByText(/No differences/)).toBeNull();
  load(); await screen.findByText(/of 23 shown inventory fields differ/);
});
it('ignores a late result after selection changes', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); load();
  view.rerender(<MemoryRouter><AssetComparison ids={[9, 30]} /></MemoryRouter>); await act(async () => finish({ data: first })); expect(screen.queryByText(/of 23 shown inventory fields differ/)).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
});
it('rejects duplicate record selection without reading either endpoint', async () => {
  show([7, 7]); load(); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
