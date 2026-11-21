import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ComponentEvidenceExport } from './ComponentEvidenceExport';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get), create = vi.fn(), revoke = vi.fn(), click = vi.fn();
const scope = { search: 'openssl', version: '3.0', vulnerable_only: true };
const row = { component: { id: 209, sbom_id: 99, version: '3.0', has_known_vulnerability: 2, hash_sha256: null }, sbom_id: 99, asset_id: 7 };
const snapshot = { ...scope, schema: 'onealert.recorded-component-evidence.v1', complete: true, scoped_asset_id: 7, total: 1, document_count: 1, asset_count: 1, retrieved_at: '2026-11-21T00:00:00Z', limitations: ['Saved evidence only'], records: [row] };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); create.mockReturnValue('blob:evidence'); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = () => render(<ComponentEvidenceExport scope={scope} assetId={7} />);
const download = () => fireEvent.click(screen.getByRole('button', { name: 'Download all matching component evidence JSON' }));
it('downloads complete JSON with exact applied filters and no pagination', async () => {
  mount(); expect(get).not.toHaveBeenCalled(); download(); await screen.findByText(/Downloaded 1 matching saved component rows/);
  expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/component-search/export', { params: { ...scope, asset_id: 7 } }); expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:evidence');
  expect((create.mock.calls[0][0] as Blob).type).toBe('application/json'); expect(screen.getByText(/no partial download/)).toBeTruthy();
});
it.each([{ ...snapshot, search: 'wrong' }, { ...snapshot, scoped_asset_id: 8 }, { ...snapshot, complete: false }, { ...snapshot, total: 2 }, { ...snapshot, schema: 'unknown' }, { ...snapshot, document_count: 2 }, { ...snapshot, records: [{ ...row, asset_id: 8 }] }, { ...snapshot, records: [{ ...row, component: { ...row.component, sbom_id: 98 } }] }, { ...snapshot, records: [{ ...row, component: { ...row.component, version: '4.0' } }] }, { ...snapshot, records: [{ ...row, component: { ...row.component, has_known_vulnerability: 0 } }] }, { ...snapshot, retrieved_at: '' }])('refuses incomplete or mismatched export %#', async data => {
  get.mockResolvedValueOnce({ data }); mount(); download(); await screen.findByRole('alert'); expect(create).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
});
it('keeps service errors separate from empty evidence and retries the same scope', async () => {
  get.mockRejectedValueOnce(new Error('Too many matching rows. Narrow the applied search.')); mount(); download(); await screen.findByRole('alert'); expect(create).not.toHaveBeenCalled(); download(); await screen.findByText(/Downloaded 1/); expect(screen.queryByRole('alert')).toBeNull();
});
it('exports a complete empty result without claiming software absence', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, total: 0, document_count: 0, asset_count: 0, records: [] } }); mount(); download(); await screen.findByText(/Downloaded 0 matching saved component rows/); expect(click).toHaveBeenCalledOnce();
});
it('does not download after its scope is unmounted and blocks duplicate in-flight clicks', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = mount(); download();
  expect(screen.getByRole('button', { name: 'Preparing complete component evidence...' })).toHaveProperty('disabled', true); expect(get).toHaveBeenCalledOnce(); view.unmount(); await act(async () => finish({ data: snapshot })); expect(create).not.toHaveBeenCalled();
});
it('exports across all assets without adding an inferred asset identifier', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, scoped_asset_id: null } }); render(<ComponentEvidenceExport scope={scope} />); download();
  await waitFor(() => expect(click).toHaveBeenCalledOnce()); expect(get).toHaveBeenCalledWith('/sbom/component-search/export', { params: scope });
});
