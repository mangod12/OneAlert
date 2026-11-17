import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Sbom } from './Sbom';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), delete: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const del = vi.mocked(apiClient.delete);

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
    throw new Error(`unexpected ${url}`);
  });
  del.mockResolvedValue({ data: {} });
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

  it('deletes an SBOM through the confirm dialog', async () => {
    render(<Sbom />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete SBOM for Plant gateway' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Delete SBOM' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/sbom/1'));
  });
});
