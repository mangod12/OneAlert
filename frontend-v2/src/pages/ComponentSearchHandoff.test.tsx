import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SbomComponentSearch } from './SbomComponentSearch';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get), writeText = vi.fn();
const record = { component: { id: 209, sbom_id: 99, name: 'Saved openssl', version: '3.0', has_known_vulnerability: 2 }, sbom_id: 99, asset_id: 7, asset_name: 'Owned gateway' };
function Links() { const navigate = useNavigate(); return <button onClick={() => navigate('?search=new-search&asset=8')}>Open another search link</button>; }
const mount = (query: string) => render(<MemoryRouter initialEntries={[`/sbom/components?${query}`]}><SbomComponentSearch /><Links /></MemoryRouter>);
beforeEach(() => {
  vi.resetAllMocks(); writeText.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  get.mockImplementation(async (_url, config) => {
    const params = config?.params as Record<string, unknown>;
    return { data: { ...params, total: 1, asset_count: 1, document_count: 1, scoped_asset_id: params.asset_id ?? null, scoped_asset_name: 'Owned gateway', records: [{ ...record, asset_id: params.asset_id ?? 7 }], assets: [], versions: [], retrieved_at: 'now' } };
  });
});
afterEach(cleanup);
it('restores exact applied filters and owned asset scope without a broad request', async () => {
  mount('search=openssl&version=3.0&vulnerable=1&asset=7'); await screen.findByText('Saved openssl · 3.0');
  expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/component-search', { params: { search: 'openssl', version: '3.0', vulnerable_only: true, asset_id: 7, page: 1, size: 10 } });
  expect(screen.getByText('Matching saved rows for asset #7: Owned gateway')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Return to matching rows across all assets' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/sbom/component-search', { params: { search: 'openssl', version: '3.0', vulnerable_only: true, page: 1, size: 10 } }));
});
it.each(['assets', 'versions'])('restores %s grouping without fetching broad component rows', async view => {
  mount(`search=openssl&view=${view}`);
  await waitFor(() => expect(get).toHaveBeenCalledExactlyOnceWith(`/sbom/component-search/${view}`, { params: { search: 'openssl', version: '', vulnerable_only: false, page: 1, size: 10 } }));
});
it.each(['search=', 'search=%20', 'version=3.0', 'search=a&search=b', 'search=a&version=1&version=2', 'search=a&vulnerable=1&vulnerable=0', 'search=a&view=assets&view=records', 'search=a&asset=7&asset=8', 'search=a&asset=0', 'search=a&asset=-1', 'search=a&asset=1.5', 'search=a&asset=2147483648', 'search=a&asset=7&view=assets', 'search=a&view=unknown', 'search=a&vulnerable=true', 'search=a&asset=', `search=${'a'.repeat(201)}`, `search=a&version=${'1'.repeat(201)}`])('rejects ambiguous or invalid scope without running any fallback search: %s', async query => {
  mount(query); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Copy applied component search link' })).toBeNull();
});
it('allows a new explicit submitted search to replace an invalid handoff', async () => {
  mount('search=openssl&asset=nope'); expect(get).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'busybox' } }); fireEvent.click(screen.getByRole('button', { name: 'Search retained documents' }));
  await screen.findByText('Saved openssl · 3.0'); expect(screen.queryByRole('alert')).toBeNull(); expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/component-search', { params: { search: 'busybox', version: '', vulnerable_only: false, page: 1, size: 10 } });
});
it('copies only applied filters and exact asset, never drafts, unrelated query data, hash or pagination', async () => {
  mount('search=openssl&version=3.0&vulnerable=1&asset=7&private=omit#private'); await screen.findByText('Saved openssl · 3.0');
  fireEvent.change(screen.getByLabelText('Cross-asset component search'), { target: { value: 'private draft' } }); fireEvent.change(screen.getByLabelText('Exact recorded component version'), { target: { value: 'draft-version' } }); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy applied component search link' })); await screen.findByText(/Applied component search link copied/);
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/sbom/components?search=openssl&version=3.0&vulnerable=1&asset=7`);
  expect(screen.getByText(/Only share it where those query details belong/)).toBeTruthy();
});
it('round-trips literal punctuation and Unicode query text and selected display', async () => {
  const search = 'pkg:generic/lib_ssl% + π & gateway', params = new URLSearchParams({ search, version: '3.0+vendor', view: 'versions' }); mount(params.toString());
  await screen.findByText('Recorded component versions'); fireEvent.click(screen.getByRole('button', { name: 'Copy applied component search link' })); await screen.findByText(/Applied component search link copied/);
  const copied = new URL(writeText.mock.calls[0][0]); expect(copied.searchParams.get('search')).toBe(search); expect(copied.searchParams.get('version')).toBe('3.0+vendor'); expect(copied.searchParams.get('view')).toBe('versions');
});
it('replaces a same-page route and ignores an older pending search result', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); mount('search=old&asset=7');
  fireEvent.click(screen.getByRole('button', { name: 'Open another search link' })); await screen.findByText('Saved openssl · 3.0');
  expect(get).toHaveBeenLastCalledWith('/sbom/component-search', { params: { search: 'new-search', version: '', vulnerable_only: false, asset_id: 8, page: 1, size: 10 } });
  await act(async () => finish({ data: {} })); expect(screen.queryByRole('alert')).toBeNull(); expect((screen.getByLabelText('Cross-asset component search') as HTMLInputElement).value).toBe('new-search');
});
it('keeps clipboard failure separate from search failure and does not assert the address bar is current', async () => {
  writeText.mockRejectedValueOnce(new Error('denied')); mount('search=openssl'); await screen.findByText('Saved openssl · 3.0'); fireEvent.click(screen.getByRole('button', { name: 'Copy applied component search link' }));
  await screen.findByText('Copy unavailable. Your applied search is unchanged.'); expect(screen.getByText('Saved openssl · 3.0')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
});
it('does not leave a copy confirmation for a previous display scope', async () => {
  let finish!: () => void; writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })); mount('search=openssl'); await screen.findByText('Saved openssl · 3.0');
  fireEvent.click(screen.getByRole('button', { name: 'Copy applied component search link' })); fireEvent.click(screen.getByRole('button', { name: 'Group by recorded version' })); await screen.findByText('Recorded component versions');
  await act(async () => finish()); expect(screen.queryByText(/Applied component search link copied/)).toBeNull();
});
