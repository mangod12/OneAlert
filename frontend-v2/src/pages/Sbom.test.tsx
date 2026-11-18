import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
