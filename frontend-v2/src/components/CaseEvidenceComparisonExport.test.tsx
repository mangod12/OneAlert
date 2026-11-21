import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseEvidenceComparisonExport } from './CaseEvidenceComparisonExport';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const fixture = { format: 'onealert_case_evidence_comparison_v1', exported_at: '2026-11-22T00:00:00Z', case_id: 7, other_case_id: 8, kind: 'alert', case_title: 'Source', other_case_title: 'Other', source_count: 1, other_count: 0, record_count: 1, set_counts: { shared: 0, source_only: 1, other_only: 0 }, records: { shared: [], source_only: [{ id: 2, label: 'Retained metadata', severity: null, recorded_at: null, can_open_original: false }], other_only: [] }, scope: 'Exact IDs only' };
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); URL.createObjectURL = vi.fn(() => 'blob:comparison-package'); URL.revokeObjectURL = vi.fn(); click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); });
afterEach(() => { cleanup(); click.mockRestore(); });
const show = () => render(<CaseEvidenceComparisonExport caseId={7} otherId={8} kind="alert" />);
const download = () => fireEvent.click(screen.getByRole('button', { name: 'Download all comparison sets JSON' }));
it('only reads the complete exact export after a click and prepares a local file without writes', async () => {
  show(); expect(get).not.toHaveBeenCalled(); download(); await screen.findByText(/Complete comparison download prepared/);
  expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/evidence-overlap/export', { params: { other_case_id: 8, kind: 'alert' } });
  expect(click).toHaveBeenCalledTimes(1); expect(click.mock.instances[0].download).toBe('case-7-vs-8-alert-evidence-comparison.json');
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)); expect(apiClient.post).not.toHaveBeenCalled();
  expect(screen.getByText(/Fresh export-time read/)).toBeTruthy();
});
it('holds duplicate requests and discards a late download after leaving the selected comparison', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); download();
  fireEvent.click(screen.getByRole('button', { name: 'Preparing complete comparison...' })); expect(get).toHaveBeenCalledTimes(1);
  view.unmount(); await act(async () => finish({ data: fixture })); expect(click).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it.each([new Error('Too many records. No partial file was generated.'), { response: { status: 404, data: { detail: 'Investigation not found' } } }])('does not save partial or unavailable downloads, and permits retry', async error => {
  get.mockRejectedValueOnce(error); show(); download(); await screen.findByRole('alert'); expect(click).not.toHaveBeenCalled();
  download(); await screen.findByText(/Complete comparison download prepared/); expect(click).toHaveBeenCalledTimes(1);
});
it('refuses an unbound or incomplete export without creating any object URL', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, other_case_id: 9 } }); show(); download(); await screen.findByRole('alert');
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
});
it('reports local file creation failures without claiming success', async () => {
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw Error('Local download unavailable'); }); show(); download();
  await screen.findByRole('alert'); expect(screen.queryByText(/download prepared/)).toBeNull(); expect(click).not.toHaveBeenCalled();
});
