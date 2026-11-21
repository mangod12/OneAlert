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
it('drills down from an asset group using applied filters and returns to all assets explicitly', async () => {
  get.mockImplementation(async (url: string, config) => {
    const params = config?.params as Record<string, unknown>;
    return { data: url.endsWith('/assets') ? { ...snapshot, ...params } : { ...params, total: 1, document_count: 1, asset_count: 1, scoped_asset_id: params.asset_id ?? null, scoped_asset_name: params.asset_id ? 'Current plant gateway' : null, retrieved_at: 'now', records: [{ component: { id: 9, sbom_id: 99, name: 'openssl', version: '3.0', has_known_vulnerability: 1 }, sbom_id: 99, asset_id: 7, asset_name: 'Current plant gateway' }] } };
  });
  render(<SbomComponentSearch />); fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'openssl' } }); fireEvent.change(screen.getByLabelText('Exact recorded component version'), { target: { value: '3.0' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Search retained documents' })); await screen.findByText('openssl · 3.0');
  fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'draft not applied' } }); fireEvent.click(screen.getByRole('button', { name: 'Group matching records by asset' })); await screen.findByText('Plant gateway · Asset #7'); fireEvent.click(screen.getByRole('button', { name: 'Browse matching saved rows for asset #7' })); await screen.findByText('Matching saved rows for asset #7: Current plant gateway');
  expect(get).toHaveBeenLastCalledWith('/sbom/component-search', { params: { search: 'openssl', version: '3.0', vulnerable_only: true, asset_id: 7, page: 1, size: 10 } }); expect(screen.getByText(/Draft search not applied/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Return to matching rows across all assets' })); await screen.findByText('openssl · 3.0'); expect(get).toHaveBeenLastCalledWith('/sbom/component-search', { params: { search: 'openssl', version: '3.0', vulnerable_only: true, page: 1, size: 10 } });
});
it('rejects drilldown responses for a different asset without falling back to all assets', async () => {
  get.mockImplementation(async (url: string, config) => ({ data: url.endsWith('/assets') ? snapshot : { ...scope, ...((config?.params ?? {}) as object), scoped_asset_id: 8, total: 1, document_count: 1, asset_count: 1, records: [] } }));
  render(<SbomComponentSearch />); fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'openssl' } }); fireEvent.click(screen.getByRole('button', { name: 'Search retained documents' })); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Group matching records by asset' })); await screen.findByText('Plant gateway · Asset #7'); fireEvent.click(screen.getByRole('button', { name: 'Browse matching saved rows for asset #7' })); await screen.findByRole('alert'); expect(screen.queryByRole('link', { name: /Open exact SBOM/ })).toBeNull();
  expect(get).toHaveBeenLastCalledWith('/sbom/component-search', { params: { ...scope, asset_id: 7, page: 1, size: 10 } });
});
