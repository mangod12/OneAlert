import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ComponentAssetImpact } from './ComponentAssetImpact';
import { SbomComponentSearch } from '../pages/SbomComponentSearch';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const scope = { search: 'openssl', version: '', vulnerable_only: false };
const asset = { asset_id: 7, asset_name: 'Plant gateway', matching_rows: 9, document_count: 3, recorded_version_count: 2, missing_version_rows: 1, rows_with_recorded_vulnerabilities: 4, newest_matching_document_at: '2026-11-01T00:00:00Z' };
const snapshot = { ...scope, page: 1, size: 10, total: 1, retrieved_at: 'now', assets: [asset] };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); }); afterEach(cleanup);
it('shows one owned asset with separate retained-document, missing-version and recorded-vulnerability counts', async () => {
  render(<ComponentAssetImpact scope={scope} />); await screen.findByText('Plant gateway · Asset #7');
  expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/component-search/assets', { params: { ...scope, page: 1, size: 10 } });
  expect(screen.getByText('Rows with missing version')).toBeTruthy(); expect(screen.getByText('Distinct nonempty recorded versions')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open exact asset #7' }).getAttribute('href')).toBe('/app/assets?asset=7');
  expect(screen.getByText(/not current installations, distinct CVEs/)).toBeTruthy();
});
it.each([{ ...snapshot, search: 'other' }, { ...snapshot, page: 2 }, { ...snapshot, assets: [{ ...asset, asset_id: -1 }] }, { ...snapshot, assets: [{ ...asset, rows_with_recorded_vulnerabilities: 10 }] }, { ...snapshot, assets: [asset, asset] }, { ...snapshot, assets: [{ ...asset, recorded_version_count: 9, missing_version_rows: 1 }] }, { ...snapshot, assets: [{ ...asset, document_count: 10 }] }])('rejects mismatched identities or impossible counts %#', async data => {
  get.mockResolvedValue({ data }); render(<ComponentAssetImpact scope={scope} />); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('paginates and clamps after current records disappear without treating an error as no matches', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, total: 11 } }); render(<ComponentAssetImpact scope={scope} />); await screen.findByText('Asset page 1 of 2');
  get.mockResolvedValueOnce({ data: { ...snapshot, page: 2, total: 1, assets: [] } }); get.mockResolvedValueOnce({ data: snapshot }); fireEvent.click(screen.getByRole('button', { name: 'More matching assets' })); await screen.findByText('Asset page 1 of 1');
  get.mockRejectedValueOnce(new Error('offline')); fireEvent.click(screen.getByRole('button', { name: 'Refresh matching assets' })); await screen.findByRole('alert'); expect(screen.queryByText('Plant gateway · Asset #7')).toBeNull(); expect(screen.queryByText(/No assets have matching/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry matching assets' })); await screen.findByText('Plant gateway · Asset #7');
});
it('ignores an older asset-group response after a newer search scope', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<ComponentAssetImpact scope={scope} />);
  get.mockResolvedValueOnce({ data: { ...snapshot, search: 'new-query', assets: [{ ...asset, asset_name: 'New match' }] } }); view.rerender(<ComponentAssetImpact scope={{ ...scope, search: 'new-query' }} />); await screen.findByText('New match · Asset #7');
  await act(async () => finish({ data: snapshot })); expect(screen.queryByText('Plant gateway · Asset #7')).toBeNull();
});
it('uses the applied scope rather than draft text when switching the full page to asset grouping', async () => {
  get.mockImplementation(async (url: string) => ({ data: url.endsWith('/assets') ? snapshot : { ...scope, page: 1, size: 10, total: 0, document_count: 0, asset_count: 0, retrieved_at: 'now', records: [] } }));
  render(<SbomComponentSearch />); fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'openssl' } }); fireEvent.click(screen.getByRole('button', { name: 'Search retained documents' })); await screen.findByText(/No saved component rows match/);
  fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'draft not submitted' } }); fireEvent.click(screen.getByRole('button', { name: 'Group matching records by asset' })); await screen.findByText('Plant gateway · Asset #7');
  expect(get).toHaveBeenLastCalledWith('/sbom/component-search/assets', { params: { ...scope, page: 1, size: 10 } }); expect(screen.getByText(/Draft search not applied/)).toBeTruthy();
});
