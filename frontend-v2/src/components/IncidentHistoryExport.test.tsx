import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { IncidentHistoryExport } from './IncidentHistoryExport';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const click = () => fireEvent.click(screen.getByRole('button', { name: 'Export all matching incident history' }));
let anchorClick: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: new Blob(['asset_id,recorded_detail\n5,Saved change'], { type: 'text/csv;charset=utf-8' }) });
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:incident-history'); static revokeObjectURL = vi.fn(); });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('only exports the selected asset and applied filters on request, with private-copy caveats', async () => {
  render(<IncidentHistoryExport assetId={5} search="retained keyword" kind="alert_updated" disabled={false} />);
  expect(get).not.toHaveBeenCalled(); click(); await screen.findByText(/download prepared/);
  expect(get).toHaveBeenCalledExactlyOnceWith('/incidents/5/timeline/export', { params: { search: 'retained keyword', kind: 'alert_updated' }, responseType: 'blob' });
  expect(anchorClick).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:incident-history');
  expect(screen.getByText(/Keep the CSV private/)).toBeTruthy(); expect(screen.getByText(/not only this page/)).toBeTruthy();
});
it('omits empty filters and prevents downloads while the history read is unavailable', async () => {
  const view = render(<IncidentHistoryExport assetId={5} search="" kind="" disabled />); click(); expect(get).not.toHaveBeenCalled();
  view.rerender(<IncidentHistoryExport assetId={5} search="" kind="" disabled={false} />); click(); await screen.findByText(/download prepared/);
  expect(get).toHaveBeenCalledWith('/incidents/5/timeline/export', { params: {}, responseType: 'blob' });
});
it.each([{}, 'csv text', new Blob(['not CSV'], { type: 'application/json' })])('rejects a non-CSV response %# without creating a file', async value => {
  get.mockResolvedValueOnce({ data: value }); render(<IncidentHistoryExport assetId={5} search="" kind="" disabled={false} />); click();
  await screen.findByRole('alert'); expect(anchorClick).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('does not download a late response after applied filter changes remount the control', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<IncidentHistoryExport key="old" assetId={5} search="old" kind="" disabled={false} />); click();
  view.rerender(<IncidentHistoryExport key="new" assetId={5} search="new" kind="" disabled={false} />);
  await act(async () => finish({ data: new Blob(['old'], { type: 'text/csv' }) })); expect(anchorClick).not.toHaveBeenCalled();
  click(); await screen.findByText(/download prepared/); expect(get).toHaveBeenLastCalledWith('/incidents/5/timeline/export', { params: { search: 'new' }, responseType: 'blob' });
});
it('prevents concurrent exports and allows a retry after failure', async () => {
  let fail!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  render(<IncidentHistoryExport assetId={5} search="" kind="" disabled={false} />); click();
  fireEvent.click(screen.getByRole('button', { name: 'Preparing incident history CSV...' })); expect(get).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('Export unavailable'))); await screen.findByRole('alert'); click(); await screen.findByText(/download prepared/);
});
it('revokes the blob URL even if browser download preparation fails', async () => {
  anchorClick.mockImplementationOnce(() => { throw new Error('Browser blocked download'); });
  render(<IncidentHistoryExport assetId={5} search="" kind="" disabled={false} />); click(); await screen.findByRole('alert');
  expect(URL.revokeObjectURL).toHaveBeenCalled(); expect(screen.queryByText(/download prepared/)).toBeNull();
});
it('reports a bounded JSON export refusal without downloading a partial file', async () => {
  const blob = new Blob(['{"detail":"Narrow the filters; no partial file was generated."}'], { type: 'application/json' });
  Object.defineProperty(blob, 'text', { value: async () => '{"detail":"Narrow the filters; no partial file was generated."}' });
  get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 413, data: blob } });
  render(<IncidentHistoryExport assetId={5} search="" kind="" disabled={false} />); click();
  await screen.findByText('Narrow the filters; no partial file was generated.'); expect(anchorClick).not.toHaveBeenCalled();
});
