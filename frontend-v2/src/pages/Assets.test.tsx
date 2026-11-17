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

  it('does not delete an asset when confirmation is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Assets />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Plant gateway' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a confirmed asset and refreshes inventory', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Assets />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Plant gateway' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('/assets/7');
      expect(get).toHaveBeenCalledTimes(2);
    });
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
