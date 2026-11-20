import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { DeviceAssetLinkReview } from './DeviceAssetLinkReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), onClose = vi.fn(), onLinked = vi.fn();
const asset = { id: 10, name: 'Inventory gateway', asset_type: 'hardware', vendor: 'Recorded vendor', product: 'MX', version: '1', firmware_version: null, serial_number: 'S-10', last_known_ip: '192.0.2.10', criticality: 'high' };
const device = { id: 1, ip_address: '192.0.2.10', hostname: 'Observed gateway', manufacturer: 'Observed vendor', model: 'MX', firmware_version: '1', serial_number: 'S-10', asset_id: null, is_correlated: false };
const review = { device, asset, can_link: true, reviewed_fingerprint: 'a'.repeat(64) };
const mount = () => render(<DeviceAssetLinkReview deviceId={1} onClose={onClose} onLinked={onLinked} />);
const select = async () => { fireEvent.click(await screen.findByRole('button', { name: /Review asset #10/ })); await screen.findByText('Discovered device #1'); };
beforeEach(() => {
  vi.resetAllMocks(); get.mockImplementation(async url => url === '/assets/' ? { data: { assets: [asset], total: 1 } } : { data: review });
  post.mockResolvedValue({ data: { ...device, asset_id: 10, is_correlated: true, correlation_score: 100 } });
});
afterEach(cleanup);
it('loads inventory then the exact comparison before any write and requires acknowledgement', async () => {
  mount(); await select(); expect(get).toHaveBeenCalledWith('/ot/discovered-devices/1/correlation-review/10');
  expect(screen.getByText('Observed vendor')).toBeTruthy(); expect(screen.getByText('Recorded vendor')).toBeTruthy();
  const link = screen.getByRole('button', { name: 'Link reviewed records' }); expect(link).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(link);
  await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledExactlyOnceWith('/ot/discovered-devices/1/correlate/10', undefined, { params: { reviewed_fingerprint: 'a'.repeat(64) } });
});
it('searches and pages the full inventory and drops the prepared comparison when scope changes', async () => {
  get.mockImplementation(async url => url === '/assets/' ? { data: { assets: [asset], total: 21 } } : { data: review });
  mount(); await select(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Next assets' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 2, size: 10, sort: 'name_asc' } }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.change(screen.getByLabelText('Search managed assets'), { target: { value: 'gateway' } });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 10, sort: 'name_asc', search: 'gateway' } }));
  expect(post).not.toHaveBeenCalled();
});
it('does not overwrite an existing or inconsistent link', async () => {
  get.mockImplementation(async url => url === '/assets/' ? { data: { assets: [asset], total: 1 } } : { data: { ...review, can_link: false, device: { ...device, asset_id: 19, is_correlated: true } } });
  mount(); await select(); expect(screen.getByText(/No link will be overwritten/)).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('requires fresh evidence after a failed write and clears acknowledgement on reload', async () => {
  post.mockRejectedValue(new Error('Changed record')); mount(); await select(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Link reviewed records' })); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Link reviewed records' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload correlation review' })); await screen.findByRole('checkbox');
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); expect(post).toHaveBeenCalledTimes(1);
});
it.each([{ ...device, id: 2, asset_id: 10, is_correlated: true, correlation_score: 100 }, { ...device, asset_id: 11, is_correlated: true, correlation_score: 100 }, { ...device, asset_id: 10, is_correlated: false, correlation_score: 100 }, { ...device, asset_id: 10, is_correlated: true, correlation_score: 0 }])('rejects ambiguous association acknowledgements %#', async data => {
  post.mockResolvedValue({ data }); mount(); await select(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Link reviewed records' }));
  await screen.findByRole('alert'); expect(onLinked).not.toHaveBeenCalled();
});
it('blocks duplicate submits, candidate changes, search, reload and dismissal during save', async () => {
  let resolve!: (value: unknown) => void; post.mockReturnValue(new Promise(r => { resolve = r; }));
  mount(); await select(); fireEvent.click(screen.getByRole('checkbox'));
  const link = screen.getByRole('button', { name: 'Link reviewed records' }); fireEvent.click(link); fireEvent.click(link);
  fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Search managed assets')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Reload correlation review' })).toHaveProperty('disabled', true);
  await act(async () => resolve({ data: { ...device, asset_id: 10, is_correlated: true, correlation_score: 100 } }));
  expect(onLinked).toHaveBeenCalledTimes(1);
});
it.each([{ ...review, device: { ...device, id: 2 } }, { ...review, asset: { ...asset, id: 11 } }, { ...review, reviewed_fingerprint: '' }, { ...review, can_link: true, device: { ...device, asset_id: 10 } }])('fails closed when comparison cannot be verified %#', async data => {
  get.mockImplementation(async url => url === '/assets/' ? { data: { assets: [asset], total: 1 } } : { data });
  mount(); fireEvent.click(await screen.findByRole('button', { name: /Review asset #10/ })); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Link reviewed records' })).toHaveProperty('disabled', true); expect(post).not.toHaveBeenCalled();
});
it('retries inventory failure without writes', async () => {
  get.mockRejectedValueOnce(new Error('offline')); mount(); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Reload asset search' })); await screen.findByRole('button', { name: /Review asset #10/ }); expect(post).not.toHaveBeenCalled();
});
