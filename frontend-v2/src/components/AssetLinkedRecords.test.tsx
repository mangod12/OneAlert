import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssetLinkedRecords } from './AssetLinkedRecords';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const snapshot = { asset_id: 7, asset_name: 'Gateway', kind: 'alerts', page: 1, size: 10, search: '', total: 11, counts: { alerts: 11, sboms: 2, discovered_devices: 1, suppression_rules: 1 }, unavailable_reference_count: 1, retrieved_at: '2026-11-20T00:00:00Z', records: [{ id: 20, title: 'Closed finding', status: 'resolved' }] };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Load linked operational records' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); });
afterEach(cleanup);
it('loads no references until requested and opens an exact alert record', async () => {
  render(<AssetLinkedRecords assetId={7} />); expect(get).not.toHaveBeenCalled(); open(); await screen.findByText('Closed finding');
  expect(get).toHaveBeenCalledExactlyOnceWith('/assets/7/linked-records', { params: { kind: 'alerts', page: 1, size: 10, search: '' } });
  expect(screen.getByText(/additional references are unavailable/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open exact alert #20' }).getAttribute('href')).toBe('/app/alerts?alert=20');
});
it('pages matching records on the server and resets search when changing record type', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as Record<string, unknown>), records: [] } }));
  render(<AssetLinkedRecords assetId={7} />); open(); await screen.findByText(/11 matching alert records/);
  fireEvent.click(screen.getByRole('button', { name: 'More linked records' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/7/linked-records', { params: { kind: 'alerts', page: 2, size: 10, search: '' } }));
  fireEvent.change(screen.getByLabelText('Search linked records'), { target: { value: 'closed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search linked records' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/7/linked-records', { params: { kind: 'alerts', page: 1, size: 10, search: 'closed' } }));
  fireEvent.change(screen.getByLabelText('Linked record type'), { target: { value: 'suppression_rules' } });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/7/linked-records', { params: { kind: 'suppression_rules', page: 1, size: 10, search: '' } }));
});
it('displays false and zero explicitly and links exact discovery IDs', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as Record<string, unknown>), total: 1, records: [{ id: 9, is_correlated: false, risk_score: 0, hostname: null }] } }));
  render(<AssetLinkedRecords assetId={7} />); open(); await screen.findByText('No');
  expect(screen.getByText('0')).toBeTruthy(); expect(screen.getByText('Not recorded')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Linked record type'), { target: { value: 'discovered_devices' } });
  expect((await screen.findByRole('link', { name: 'Open exact discovery record #9' })).getAttribute('href')).toBe('/app/ot?device=9');
});
it('clears old records on read failure and supports independent retry', async () => {
  render(<AssetLinkedRecords assetId={7} />); open(); await screen.findByText('Closed finding'); get.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh linked records' })); await screen.findByRole('alert'); expect(screen.queryByText('Closed finding')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh linked records' })); await screen.findByText('Closed finding');
});
it.each([{ ...snapshot, asset_id: 8 }, { ...snapshot, kind: 'sboms' }, { ...snapshot, page: 2 }, { ...snapshot, search: 'wrong' }, { ...snapshot, records: [{ id: 0 }] }])('rejects mismatched evidence %#', async data => {
  get.mockResolvedValue({ data }); render(<AssetLinkedRecords assetId={7} />); open(); await screen.findByRole('alert'); expect(screen.queryByText('Closed finding')).toBeNull();
});
it('ignores stale responses after changing record type', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  render(<AssetLinkedRecords assetId={7} />); open(); get.mockResolvedValue({ data: { ...snapshot, kind: 'sboms', total: 1, records: [{ id: 8, format: 'SPDX' }] } });
  fireEvent.change(screen.getByLabelText('Linked record type'), { target: { value: 'sboms' } }); await screen.findByText('SPDX');
  await act(async () => resolve({ data: snapshot })); expect(screen.queryByText('Closed finding')).toBeNull();
});
it('recovers when a result page disappears after records are removed', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as Record<string, unknown>), total: get.mock.calls.length === 1 ? 11 : 1 } }));
  render(<AssetLinkedRecords assetId={7} />); open(); await screen.findByText('Closed finding');
  fireEvent.click(screen.getByRole('button', { name: 'More linked records' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('button', { name: 'Previous linked records' })).toHaveProperty('disabled', true);
});
