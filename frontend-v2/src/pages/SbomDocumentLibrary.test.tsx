import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SbomDocumentLibrary } from './SbomDocumentLibrary';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
type Scope = { page: number; size: number; query: string; asset_id?: number; document_format: string; source: string; vulnerabilities_only: boolean; sort: string };
function fixture(params: Scope) { return { ...params, asset_id: params.asset_id ?? null, total: 11, formats: ['SPDX', 'CycloneDX'], sources: ['upload', 'vendor_provided'], retrieved_at: '2026-11-21T05:00:00Z', documents: [{ id: params.page === 1 ? 17 : 7, asset_id: params.asset_id ?? 4, asset_name: 'Gateway 100%_safe', format: params.document_format || 'SPDX', source: params.source || 'vendor_provided', version: '1.0', component_count: 23, vulnerability_count: 2, created_at: '2026-11-20T12:00:00Z' }] }; }
const renderLibrary = () => render(<MemoryRouter><SbomDocumentLibrary /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (_url, config) => ({ data: fixture(config?.params as Scope) })); });
afterEach(cleanup);
describe('SBOM document library', () => {
  it('shows exact document and asset links with recorded counts and search limits', async () => {
    renderLibrary(); expect(await screen.findByRole('link', { name: 'Open exact SBOM #17' })).toHaveProperty('href', expect.stringContaining('/sbom?sbom=17'));
    expect(screen.getByRole('link', { name: 'Open exact asset #4' }).getAttribute('href')).toBe('/assets?asset=4');
    expect(screen.getByText(/not a fresh scan or a count of distinct CVEs/)).toBeTruthy();
    expect(screen.getByText('Recorded components')).toBeTruthy();
    expect(screen.getByText(/11 matching documents/)).toBeTruthy();
  });
  it('keeps drafts separate, applies exact combined scope and pages through matches', async () => {
    renderLibrary(); await screen.findByRole('link', { name: 'Open exact SBOM #17' });
    fireEvent.change(screen.getByLabelText('Search SBOM documents'), { target: { value: '  100%_safe  ' } });
    fireEvent.change(screen.getByLabelText('Document library asset ID'), { target: { value: '4' } });
    expect(screen.getByText(/Document search draft not applied/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByRole('form', { name: 'Search SBOM document library' }));
    fireEvent.change(screen.getByLabelText('Document library format'), { target: { value: 'SPDX' } });
    fireEvent.change(screen.getByLabelText('Document library source'), { target: { value: 'vendor_provided' } });
    fireEvent.change(screen.getByLabelText('Document library order'), { target: { value: 'oldest' } });
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/sbom/document-library', { params: { page: 1, size: 10, query: '100%_safe', asset_id: 4, document_format: 'SPDX', source: 'vendor_provided', vulnerabilities_only: true, sort: 'oldest' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'More documents' }));
    await screen.findByRole('link', { name: 'Open exact SBOM #7' });
    expect(get).toHaveBeenLastCalledWith('/sbom/document-library', { params: expect.objectContaining({ page: 2, query: '100%_safe', asset_id: 4, sort: 'oldest' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Clear document library filters' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/sbom/document-library', { params: { page: 1, size: 10, query: '', asset_id: undefined, document_format: '', source: '', vulnerabilities_only: false, sort: 'newest' } }));
  });
  it.each(['0', '-1', '4x', '1.5', '9007199254740992'])('rejects invalid exact asset %s without applying it', async value => {
    renderLibrary(); await screen.findByRole('link', { name: 'Open exact SBOM #17' });
    fireEvent.change(screen.getByLabelText('Document library asset ID'), { target: { value } });
    fireEvent.submit(screen.getByRole('form', { name: 'Search SBOM document library' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Use one positive whole-number asset ID. The draft has not been applied.');
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('rejects a response from another filter scope and retries', async () => {
    const original = get.getMockImplementation()!; get.mockImplementationOnce(async (_url, config) => ({ data: { ...fixture(config?.params as Scope), query: 'wrong query' } }));
    renderLibrary(); expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByRole('link', { name: 'Open exact SBOM #17' })).toBeNull();
    get.mockImplementation(original); fireEvent.click(screen.getByRole('button', { name: 'Refresh document library' }));
    expect(await screen.findByRole('link', { name: 'Open exact SBOM #17' })).toBeTruthy();
  });
  it('ignores stale reads and shows an empty search without inventing metadata', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderLibrary(); fireEvent.change(screen.getByLabelText('Search SBOM documents'), { target: { value: 'absent' } });
    get.mockImplementation(async (_url, config) => ({ data: { ...fixture(config?.params as Scope), total: 0, documents: [] } }));
    fireEvent.submit(screen.getByRole('form', { name: 'Search SBOM document library' }));
    await screen.findByText('No documents match the applied filters.');
    await act(async () => finish({ data: fixture({ page: 1, size: 10, query: '', document_format: '', source: '', vulnerabilities_only: false, sort: 'newest' }) }));
    expect(screen.queryByRole('link', { name: 'Open exact SBOM #17' })).toBeNull();
  });
});
