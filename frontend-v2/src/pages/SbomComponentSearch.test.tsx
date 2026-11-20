import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SbomComponentSearch } from './SbomComponentSearch';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const record = { component: { id: 209, sbom_id: 99, name: 'openssl', version: null, supplier: null, purl: 'pkg:generic/openssl', cpe: null, license: 'MIT', has_known_vulnerability: 0 }, sbom_id: 99, asset_id: 7, asset_name: 'Gateway', document_created_at: '2026-11-20T00:00:00Z', document_source: 'upload', document_format: 'SPDX' };
const snapshot = { search: 'openssl', version: '', vulnerable_only: false, page: 1, size: 10, total: 11, document_count: 2, asset_count: 1, retrieved_at: 'now', records: [record] };
const submit = (query='openssl') => { fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: query } }); fireEvent.click(screen.getByRole('button', { name: 'Search retained documents' })); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); }); afterEach(cleanup);
it('waits for a submitted query, then shows scoped counts and exact owned record links', async () => {
  render(<SbomComponentSearch />); expect(get).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Search retained documents' })).toHaveProperty('disabled', true);
  submit(); await screen.findByText('11 matching component rows · 2 documents · 1 assets');
  expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/component-search', { params: { search: 'openssl', version: '', vulnerable_only: false, page: 1, size: 10 } });
  expect(screen.getByRole('link', { name: 'Open exact SBOM #99' }).getAttribute('href')).toBe('/app/sbom?sbom=99');
  expect(screen.getByRole('link', { name: 'Open exact asset #7' }).getAttribute('href')).toBe('/app/assets?asset=7');
  expect(screen.getByText('0')).toBeTruthy(); expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
});
it('uses submitted search/version/recorded-vulnerability scope and resets paging on new search', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as object) } })); render(<SbomComponentSearch />); submit(); await screen.findByText('openssl · Not recorded');
  fireEvent.click(screen.getByRole('button', { name: 'More component matches' })); await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText('Exact recorded component version'), { target: { value: ' 3.0 ' } }); fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText(/Draft search not applied/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2); submit('  libssl  ');
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/sbom/component-search', { params: { search: 'libssl', version: '3.0', vulnerable_only: true, page: 1, size: 10 } }));
});
it('clears old evidence on failed refresh and retries the applied scope', async () => {
  render(<SbomComponentSearch />); submit(); await screen.findByText('openssl · Not recorded'); get.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh component matches' })); await screen.findByRole('alert'); expect(screen.queryByText('openssl · Not recorded')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry component search' })); await screen.findByText('openssl · Not recorded');
});
it.each([{ ...snapshot, search: 'other' }, { ...snapshot, page: 2 }, { ...snapshot, version: '3.0' }, { ...snapshot, records: [{ ...record, sbom_id: 98 }] }])('rejects mismatched query/document response %#', async data => {
  get.mockResolvedValue({ data }); render(<SbomComponentSearch />); submit(); await screen.findByRole('alert'); expect(screen.queryByText('openssl · Not recorded')).toBeNull();
});
it('ignores an old response after a new search arrives', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; })); render(<SbomComponentSearch />); submit();
  get.mockResolvedValueOnce({ data: { ...snapshot, search: 'busybox', total: 0, document_count: 0, asset_count: 0, records: [] } }); submit('busybox'); await screen.findByText(/No saved component rows match/);
  await act(async () => resolve({ data: snapshot })); expect(screen.queryByText('openssl · Not recorded')).toBeNull();
});
it('recovers to a valid page when retained rows disappear', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as object), total: get.mock.calls.length === 1 ? 11 : 1 } }));
  render(<SbomComponentSearch />); submit(); await screen.findByText('openssl · Not recorded'); fireEvent.click(screen.getByRole('button', { name: 'More component matches' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3)); expect(screen.getByRole('button', { name: 'Previous component matches' })).toHaveProperty('disabled', true);
});
