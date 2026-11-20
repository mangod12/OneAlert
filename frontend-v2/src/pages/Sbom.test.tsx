import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Sbom } from './Sbom';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), delete: vi.fn(), post: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const del = vi.mocked(apiClient.delete);
const post = vi.mocked(apiClient.post);

const sboms = [
  { id: 1, asset_id: 7, format: 'CycloneDX', version: '1.5', source: 'upload', component_count: 2, vulnerability_count: 1, created_at: '2026-11-15T08:00:00Z' },
];
const assets = { assets: [{ id: 7, name: 'Plant gateway' }], total: 1, page: 1, size: 100, pages: 1 };
const components = [
  { id: 1, sbom_id: 1, name: 'openssl', version: '3.0.1', supplier: 'OpenSSL', purl: null, cpe: null, license: 'Apache-2.0', has_known_vulnerability: 1 },
  { id: 2, sbom_id: 1, name: 'busybox', version: '1.36', supplier: null, purl: null, cpe: null, license: 'GPL-2.0', has_known_vulnerability: 0 },
];

beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/sbom/') return { data: sboms };
    if (url === '/assets/') return { data: assets };
    if (url === '/sbom/1/components') return { data: components };
    if (url === '/sbom/1/export') return { data: new Blob(['name,version'], { type: 'text/csv' }) };
    throw new Error(`unexpected ${url}`);
  });
  del.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SBOM page', () => {
  it('lists SBOMs with resolved asset names and vulnerability badges', async () => {
    render(<Sbom />);
    await screen.findByText('Plant gateway');
    expect(screen.getByText('CycloneDX 1.5')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('expands a row to show components with vulnerability flags', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByText('Plant gateway'));
    await screen.findByText('openssl');
    expect(screen.getByText('3.0.1')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('busybox')).toBeTruthy();
  });

  it('summarizes licenses and flags copyleft components', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByText('Plant gateway'));
    await screen.findByText('openssl');
    expect(screen.getByText('2 of 2 components licensed')).toBeTruthy();
    expect(screen.getByText('Apache-2.0 · 1')).toBeTruthy();
    expect(screen.getByText('GPL-2.0 · 1')).toBeTruthy();
    expect(screen.getByText('1 copyleft')).toBeTruthy();
  });

  it('filters expanded components by search', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByText('Plant gateway'));
    await screen.findByText('openssl');
    fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'busy' } });
    expect(screen.queryByText('openssl')).toBeNull();
    expect(screen.getByText('busybox')).toBeTruthy();
    expect(screen.getByText('1 of 2 components')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'zzz' } });
    expect(screen.getByText('No components match the current filters.')).toBeTruthy();
  });

  it('filters expanded components to vulnerable ones only', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByText('Plant gateway'));
    await screen.findByText('openssl');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vulnerable only' }));
    expect(screen.getByText('openssl')).toBeTruthy();
    expect(screen.queryByText('busybox')).toBeNull();
    expect(screen.getByText('1 of 2 components')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vulnerable only' }));
    expect(screen.getByText('busybox')).toBeTruthy();
  });

  it('exports the expanded SBOM components as CSV', async () => {
    const createUrl = vi.fn(() => 'blob:mock');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrl, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<Sbom />);
    fireEvent.click(await screen.findByText('Plant gateway'));
    await screen.findByText('openssl');
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/sbom/1/export', { responseType: 'blob' }));
    await waitFor(() => expect(createUrl).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalled();
  });

  it('deletes an SBOM through the confirm dialog', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete SBOM for Plant gateway' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Delete SBOM' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/sbom/1'));
  });
});
describe('SBOM upload', () => {
  it('uploads a pasted CycloneDX document for the selected asset', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload SBOM' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Asset'), { target: { value: '7' } });
    fireEvent.change(dialog.getByLabelText('SBOM JSON document'), { target: { value: '{"bomFormat": "CycloneDX", "specVersion": "1.5", "components": []}' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/sbom/upload', {
      asset_id: 7,
      sbom_data: { bomFormat: 'CycloneDX', specVersion: '1.5', components: [] },
      source: 'upload',
    }));
  });

  it('rejects JSON without a CycloneDX or SPDX marker', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload SBOM' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Asset'), { target: { value: '7' } });
    fireEvent.change(dialog.getByLabelText('SBOM JSON document'), { target: { value: '{"foo": 1}' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Upload' }));
    expect(await dialog.findByRole('alert')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload SBOM' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Asset'), { target: { value: '7' } });
    fireEvent.change(dialog.getByLabelText('SBOM JSON document'), { target: { value: 'not json' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Upload' }));
    expect(await dialog.findByRole('alert')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});


describe('SBOM component request identity', () => {
  it.each(['success', 'failure'])('ignores an obsolete component %s from a different SBOM', async previous => {
    let resolveOld!: (value: unknown) => void;
    let rejectOld!: (error: Error) => void;
    get.mockImplementation((url: string) => {
      if (url === '/sbom/') return Promise.resolve({ data: [...sboms, { ...sboms[0], id: 2, asset_id: 8 }] });
      if (url === '/assets/') return Promise.resolve({ data: { ...assets, assets: [...assets.assets, { id: 8, name: 'Other asset' }] } });
      if (url === '/sbom/1/components') return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
      return Promise.resolve({ data: [{ ...components[0], id: 20, sbom_id: 2, name: 'Current component' }] });
    });
    render(<Sbom />);
    fireEvent.click(await screen.findByText('Plant gateway'));
    fireEvent.click(screen.getByText('Other asset'));
    await screen.findByText('Current component');
    await act(async () => {
      if (previous === 'success') resolveOld({ data: components });
      else rejectOld(new Error('Obsolete component failure'));
    });
    expect(screen.getByText('Current component')).toBeTruthy();
    expect(screen.queryByText('openssl')).toBeNull();
    expect(screen.queryByText('Obsolete component failure')).toBeNull();
  });
  it('resets the vulnerable-only filter when opening another SBOM', async () => {
    get.mockImplementation(async url => {
      if (url === '/sbom/') return { data: [...sboms, { ...sboms[0], id: 2, asset_id: 8 }] };
      if (url === '/assets/') return { data: { ...assets, assets: [...assets.assets, { id: 8, name: 'Other asset' }] } };
      return { data: components };
    });
    render(<Sbom />);
    fireEvent.click(await screen.findByText('Plant gateway'));
    await screen.findByText('openssl');
    fireEvent.click(screen.getByLabelText('Vulnerable only'));
    expect(screen.queryByText('busybox')).toBeNull();
    fireEvent.click(screen.getByText('Other asset'));
    expect(await screen.findByText('busybox')).toBeTruthy();
    expect((screen.getByLabelText('Vulnerable only') as HTMLInputElement).checked).toBe(false);
  });
});


describe('SBOM destination asset picker', () => {
  it('reaches destination assets after the first hundred and uploads only to the chosen ID', async () => {
    get.mockImplementation(async (url, config) => {
      if (url === '/sbom/') return { data: sboms };
      if ((config?.params as { page: number })?.page === 2) return { data: { assets: [{ id: 107, name: 'Later destination' }], total: 101 } };
      return { data: { ...assets, total: 101 } };
    });
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload SBOM' }));
    fireEvent.click(screen.getByRole('button', { name: 'More assets' }));
    await screen.findByRole('option', { name: 'Later destination · #107' });
    expect(screen.getByText('Showing 101–101 of 101 matching assets · Page 2 of 2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Asset'), { target: { value: '107' } });
    fireEvent.change(screen.getByLabelText('SBOM JSON document'), { target: { value: '{"bomFormat":"CycloneDX"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/sbom/upload', { asset_id: 107, sbom_data: { bomFormat: 'CycloneDX' }, source: 'upload' }));
  });
  it('searches server-side while visibly retaining an already selected destination', async () => {
    get.mockImplementation(async (url, config) => {
      if (url === '/sbom/') return { data: sboms };
      if ((config?.params as { search?: string })?.search) return { data: { assets: [], total: 0 } };
      return { data: assets };
    });
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload SBOM' }));
    fireEvent.change(screen.getByLabelText('Asset'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Find destination asset'), { target: { value: 'missing-vendor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    expect(await screen.findByText('No matching destination assets.')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 100, search: 'missing-vendor' } });
    expect(screen.getByText(/Selected destination: Plant gateway/)).toBeTruthy();
    expect((screen.getByLabelText('Asset') as HTMLSelectElement).value).toBe('7');
  });
  it('blocks upload on a destination load failure and retries the same search', async () => {
    let fail = true;
    get.mockImplementation(async (url, config) => {
      if (url === '/sbom/') return { data: sboms };
      if ((config?.params as { search?: string })?.search) {
        if (fail) throw new Error('Destination lookup unavailable');
        return { data: { assets: [{ id: 107, name: 'Recovered destination' }], total: 1 } };
      }
      return { data: assets };
    });
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload SBOM' }));
    fireEvent.change(screen.getByLabelText('Find destination asset'), { target: { value: 'recovered' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    expect(await screen.findByText('Destination lookup unavailable')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry destination assets' }));
    expect(await screen.findByRole('option', { name: 'Recovered destination · #107' })).toBeTruthy();
  });
  it('ignores a slower obsolete destination search', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementation((url, config) => {
      if (url === '/sbom/') return Promise.resolve({ data: sboms });
      const search = (config?.params as { search?: string })?.search;
      if (search === 'old') return new Promise(resolve => { resolveOld = resolve; });
      return Promise.resolve({ data: search ? { assets: [{ id: 107, name: 'Current destination' }], total: 1 } : assets });
    });
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload SBOM' }));
    const search = screen.getByLabelText('Find destination asset');
    fireEvent.change(search, { target: { value: 'old' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    fireEvent.change(search, { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    await screen.findByRole('option', { name: 'Current destination · #107' });
    await act(async () => { resolveOld({ data: assets }); });
    expect(screen.getByRole('option', { name: 'Current destination · #107' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Plant gateway · #7' })).toBeNull();
  });
});
