import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ComponentVersionEvidence } from './ComponentVersionEvidence';
import { SbomComponentSearch } from '../pages/SbomComponentSearch';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get), scope = { search: 'openssl', version: '', vulnerable_only: false };
const row = { version: '3.0', matching_rows: 12, document_count: 3, asset_count: 2, rows_with_recorded_vulnerabilities: 4, newest_matching_document_at: null };
const snapshot = { ...scope, page: 1, size: 10, total: 1, retrieved_at: 'now', versions: [row] };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); }); afterEach(cleanup);
it('shows historical exact version groups and passes a selected version to the parent', async () => {
  const browse = vi.fn(); render(<ComponentVersionEvidence scope={scope} onBrowseVersion={browse} />); await screen.findByText('Recorded version: 3.0');
  expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/component-search/versions', { params: { ...scope, page: 1, size: 10 } }); expect(screen.getByText(/not installed-version counts/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Browse saved rows with version 3.0' })); expect(browse).toHaveBeenCalledWith('3.0');
});
it('labels missing versions and does not offer a misleading exact filter for whitespace versions', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, total: 3, versions: [{ ...row, version: null }, { ...row, version: ' ' }, { ...row, version: ' 3.0 ' }] } }); render(<ComponentVersionEvidence scope={scope} onBrowseVersion={vi.fn()} />); await screen.findByText('Version not recorded'); expect(screen.queryByRole('button', { name: /Browse saved rows/ })).toBeNull();
});
it.each([{ ...snapshot, search: 'wrong' }, { ...snapshot, page: 2 }, { ...snapshot, versions: [row, row] }, { ...snapshot, versions: [{ ...row, asset_count: 4 }] }, { ...snapshot, versions: [{ ...row, version: '' }] }, { ...snapshot, total: -1 }])('rejects mismatched or impossible version evidence %#', async data => {
  get.mockResolvedValueOnce({ data }); render(<ComponentVersionEvidence scope={scope} onBrowseVersion={vi.fn()} />); await screen.findByRole('alert'); expect(screen.queryByText('Recorded version: 3.0')).toBeNull();
});
it('clamps shrinking pages and separates failed service from no matching evidence', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, total: 11 } }); render(<ComponentVersionEvidence scope={scope} onBrowseVersion={vi.fn()} />); await screen.findByText('Version page 1 of 2');
  get.mockResolvedValueOnce({ data: { ...snapshot, page: 2, versions: [] } }); get.mockResolvedValueOnce({ data: snapshot }); fireEvent.click(screen.getByRole('button', { name: 'More recorded versions' })); await screen.findByText('Version page 1 of 1');
  get.mockRejectedValueOnce(new Error('offline')); fireEvent.click(screen.getByRole('button', { name: 'Refresh recorded version groups' })); await screen.findByRole('alert'); expect(screen.queryByText(/No matching saved version groups/)).toBeNull();
});
it('ignores a prior scope response after a new applied search', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<ComponentVersionEvidence scope={scope} onBrowseVersion={vi.fn()} />);
  get.mockResolvedValueOnce({ data: { ...snapshot, search: 'new', versions: [], total: 0 } }); view.rerender(<ComponentVersionEvidence scope={{ ...scope, search: 'new' }} onBrowseVersion={vi.fn()} />); await screen.findByText(/No matching saved version groups/); await act(async () => finish({ data: snapshot })); expect(screen.queryByText('Recorded version: 3.0')).toBeNull();
});
it('uses applied search not a draft when selecting a recorded version into component rows', async () => {
  get.mockImplementation(async (url, config) => { const params = config?.params as object; return { data: String(url).endsWith('/versions') ? { ...snapshot, ...params } : { ...params, records: [], total: 0, asset_count: 0, document_count: 0 } }; }); render(<SbomComponentSearch />);
  fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'openssl' } }); fireEvent.click(screen.getByRole('button', { name: 'Search retained documents' })); await screen.findByText(/No saved component rows/);
  fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'unapplied' } }); fireEvent.click(screen.getByRole('button', { name: 'Group by recorded version' })); await screen.findByText('Recorded version: 3.0'); fireEvent.click(screen.getByRole('button', { name: 'Browse saved rows with version 3.0' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/sbom/component-search', { params: { search: 'openssl', version: '3.0', vulnerable_only: false, page: 1, size: 10 } })); expect(screen.getByText(/Draft search not applied/)).toBeTruthy();
});
