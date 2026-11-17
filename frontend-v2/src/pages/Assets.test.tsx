import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import type { Asset } from '../api/types';
import { Assets } from './Assets';

vi.mock('../api/client', () => ({ default: {
  get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(),
} }));

const asset: Asset = {
  id: 7, name: 'Plant gateway', asset_type: 'network_device', vendor: 'Acme',
  product: 'Gateway', version: '1.0', cpe_string: null, description: null,
  is_ot_asset: true, network_zone: 'plant', primary_protocol: null,
  criticality: 'high', created_at: '2026-11-17T08:00:00Z',
};
const get = vi.mocked(apiClient.get);
const remove = vi.mocked(apiClient.delete);
const put = vi.mocked(apiClient.put);

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { assets: [asset], total: 1 } });
  remove.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Assets page', () => {
  it('renders asset identity and OT badges', async () => {
    render(<Assets />);
    expect(await screen.findByText('Plant gateway')).toBeTruthy();
    expect(screen.getByText('Acme Gateway')).toBeTruthy();
    expect(screen.getByText('OT')).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('searches the inventory with the entered query', async () => {
    render(<Assets />);
    await screen.findByText('Plant gateway');
    fireEvent.change(screen.getByPlaceholderText('Search assets...'), { target: { value: 'plant' } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/assets/', {
      params: { page: 1, size: 15, search: 'plant' },
    }));
  });

  it('filters by vendor from the dropdown', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/vendors/') return { data: ['Acme', 'Cisco'] };
      if (url === '/assets/types/') return { data: ['hardware'] };
      return { data: { assets: [asset], total: 1 } };
    });
    render(<Assets />);
    const select = await screen.findByRole('combobox', { name: 'Filter by vendor' });
    fireEvent.change(select, { target: { value: 'Cisco' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, vendor: 'Cisco' } });
    });
  });

  it('filters by criticality from the dropdown', async () => {
    render(<Assets />);
    const select = await screen.findByRole('combobox', { name: 'Filter by criticality' });
    fireEvent.change(select, { target: { value: 'high' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, criticality: 'high' } });
    });
  });

  it('filters to OT assets from the dropdown', async () => {
    render(<Assets />);
    const select = await screen.findByRole('combobox', { name: 'Filter by OT or IT' });
    fireEvent.change(select, { target: { value: 'true' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, is_ot: 'true' } });
    });
  });

  it('filters by asset type from the dropdown', async () => {
    render(<Assets />);
    await screen.findByText('Plant gateway');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by asset type' }), { target: { value: 'plc' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, asset_type: 'plc' } });
    });
  });

  it('asks for confirmation and does not delete when cancelled', async () => {
    render(<Assets />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Plant gateway' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Delete asset?')).toBeTruthy();
    expect(dialog.getByText(/Plant gateway will be removed/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a confirmed asset and refreshes inventory', async () => {
    render(<Assets />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Plant gateway' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Delete asset' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('/assets/7');
      expect(get.mock.calls.filter(([url]) => url === '/assets/').length).toBe(2);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('labels the search input and the asset form fields for assistive tech', async () => {
    render(<Assets />);
    expect(await screen.findByRole('textbox', { name: 'Search assets' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /add asset/i }));
    const dialog = await screen.findByRole('dialog');
    for (const label of ['Asset name', 'Vendor', 'Product', 'Version', 'Asset type', 'Criticality']) {
      expect(within(dialog).getByLabelText(label)).toBeTruthy();
    }
  });

  it('prefills the edit dialog and saves the changed name', async () => {
    render(<Assets />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Plant gateway' }));
    const dialog = within(screen.getByRole('dialog'));
    const name = dialog.getByPlaceholderText('Name') as HTMLInputElement;
    expect(name.value).toBe('Plant gateway');
    fireEvent.change(name, { target: { value: 'Updated gateway' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Update' }));
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/assets/7', expect.objectContaining({ name: 'Updated gateway' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('Asset type options', () => {
  it('loads the valid types from the API instead of the stale hardcoded list', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/types/') return { data: ['hardware', 'software', 'firmware', 'operating_system', 'plc', 'hmi', 'rtu', 'ied', 'scada_server', 'historian'] };
      return { data: { assets: [asset], total: 1 } };
    });
    render(<Assets />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Plant gateway' }));
    const dialog = within(screen.getByRole('dialog'));
    const select = await dialog.findByLabelText('Asset type');
    const options = Array.from((select as HTMLSelectElement).options).map(o => o.value);
    expect(options).toEqual(['hardware', 'software', 'firmware', 'operating_system', 'plc', 'hmi', 'rtu', 'ied', 'scada_server', 'historian']);
    expect(options).not.toContain('scada');
    expect(options).not.toContain('other_ot');
    expect(dialog.getByText('SCADA Server')).toBeTruthy();
    expect(dialog.getByText('Operating System')).toBeTruthy();
    expect(dialog.getByText('IED')).toBeTruthy();
  });

  it('keeps a valid fallback list when the types endpoint fails', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/types/') throw new Error('down');
      return { data: { assets: [asset], total: 1 } };
    });
    render(<Assets />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Plant gateway' }));
    const dialog = within(screen.getByRole('dialog'));
    const select = dialog.getByLabelText('Asset type');
    const options = Array.from((select as HTMLSelectElement).options).map(o => o.value);
    expect(options).toContain('scada_server');
    expect(options).not.toContain('scada');
  });
});
