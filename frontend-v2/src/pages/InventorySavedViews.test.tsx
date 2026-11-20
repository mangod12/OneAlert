import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Assets } from './Assets';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const filters = { search: 'north gateway', asset_type: 'legacy_recorded_type', vendor: 'Unavailable vendor', criticality: 'high', is_ot: false, sort: 'risk_desc' };
const views = [{ id: 1, name: 'Saved IT gateways', filters, scope: 'assets' }, { id: 2, name: 'All inventory', filters: {}, scope: 'assets' }];
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => {
  if (url === '/inventory/views/') return { data: views };
  if (url === '/assets/') return { data: { assets: [], total: 0 } };
  return { data: [] };
}); post.mockImplementation(async (_url, data) => ({ data: { id: 3, ...(data as object) } })); });
afterEach(cleanup);
const mount = () => render(<MemoryRouter><Assets /></MemoryRouter>);
it('applies every saved inventory query including false classification, missing option values and global sort', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Saved IT gateways' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, ...filters, is_ot: 'false' } }));
  expect((screen.getByLabelText('Filter by OT or IT') as HTMLSelectElement).value).toBe('false');
  expect((screen.getByLabelText('Filter by vendor') as HTMLSelectElement).value).toBe('Unavailable vendor'); expect(screen.getByText('Unavailable vendor (saved)')).toBeTruthy();
  expect((screen.getByLabelText('Filter by asset type') as HTMLSelectElement).value).toBe('legacy_recorded_type');
  expect(screen.getByText(/not selected asset records, comparison evidence/)).toBeTruthy();
});
it('an empty inventory view resets every filter and restores default ordering', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Saved IT gateways' })); await waitFor(() => expect((screen.getByLabelText('Search assets') as HTMLInputElement).value).toBe('north gateway'));
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(screen.getByRole('button', { name: 'All inventory' }));
  await waitFor(() => expect((screen.getByLabelText('Search assets') as HTMLInputElement).value).toBe(''));
  expect((screen.getByLabelText('Filter by OT or IT') as HTMLSelectElement).value).toBe(''); expect((screen.getByLabelText('Sort assets') as HTMLSelectElement).value).toBe('created_at_desc');
  expect(get).toHaveBeenLastCalledWith('/assets/', { params: { page: 1, size: 15, sort: 'created_at_desc' } });
});
it('saves only the current inventory query and no selected asset IDs or pagination', async () => {
  mount(); fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: '  west gateway  ' } }); fireEvent.change(screen.getByLabelText('Filter by OT or IT'), { target: { value: 'false' } });
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); await screen.findByRole('button', { name: 'Saved IT gateways' }); fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'IT review' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/inventory/views/', { name: 'IT review', filters: { search: 'west gateway', is_ot: false, sort: 'created_at_desc' } }));
});
