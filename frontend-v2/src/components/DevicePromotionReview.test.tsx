import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { DevicePromotionReview } from './DevicePromotionReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), onClose = vi.fn(), onPromoted = vi.fn();
const review = { device_id: 1, can_promote: true, reviewed_fingerprint: 'a'.repeat(64), proposed_asset: { name: 'PLC gateway', asset_type: 'plc', vendor: 'Acme', product: 'M10', firmware_version: '4.2', serial_number: 'S-10', last_known_ip: '192.0.2.10', criticality: 'high', primary_protocol: 'modbus' }, existing_candidates: [{ id: 10, name: 'Possible existing PLC', last_known_ip: null, serial_number: 'S-10' }], existing_candidate_total: 1 };
const result = { device_id: 1, asset_id: 11, asset_name: 'PLC gateway', reviewed_fingerprint: 'a'.repeat(64) };
const mount = () => render(<DevicePromotionReview deviceId={1} onClose={onClose} onPromoted={onPromoted} />);
const ready = async () => { await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox')); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: review }); post.mockResolvedValue({ data: result }); });
afterEach(cleanup);
it('reviews copied fields and duplicate candidates without writes, then confirms the exact proposal', async () => {
  mount(); await screen.findByText(/Possible existing PLC/); expect(screen.getByText('PLC gateway')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Create reviewed asset' }); expect(button).toHaveProperty('disabled', true); expect(post).not.toHaveBeenCalled();
  await ready(); fireEvent.click(button); await waitFor(() => expect(onPromoted).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledExactlyOnceWith('/ot/discovered-devices/1/promotion-review');
  expect(post).toHaveBeenCalledExactlyOnceWith('/ot/discovered-devices/1/promote-to-asset', undefined, { params: { reviewed_fingerprint: 'a'.repeat(64) } });
});
it('blocks already-linked devices without a creation action', async () => {
  get.mockResolvedValue({ data: { ...review, can_promote: false } }); mount(); await screen.findByText(/No new asset will be created/);
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('requires a fresh review after failed creation and clears acknowledgement on reload', async () => {
  post.mockRejectedValue(new Error('Changed inventory')); mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed asset' }));
  await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Create reviewed asset' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload promotion review' })); await screen.findByRole('checkbox');
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); expect(post).toHaveBeenCalledTimes(1);
});
it.each([{ ...result, device_id: 2 }, { ...result, asset_id: 0 }, { ...result, asset_name: 'Wrong record' }, { ...result, reviewed_fingerprint: 'b'.repeat(64) }])('rejects an unconfirmed promotion %#', async data => {
  post.mockResolvedValue({ data }); mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed asset' })); await screen.findByRole('alert'); expect(onPromoted).not.toHaveBeenCalled();
});
it('blocks repeat submits, cancellation, Escape and reload during creation', async () => {
  let resolve!: (value: unknown) => void; post.mockReturnValue(new Promise(r => { resolve = r; }));
  mount(); await ready(); const button = screen.getByRole('button', { name: 'Create reviewed asset' }); fireEvent.click(button); fireEvent.click(button);
  fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onClose).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Reload promotion review' })).toHaveProperty('disabled', true);
  await act(async () => resolve({ data: result })); expect(onPromoted).toHaveBeenCalledTimes(1);
});
it.each([{ ...review, device_id: 2 }, { ...review, reviewed_fingerprint: '' }, { ...review, existing_candidate_total: -1 }])('rejects invalid proposal %#', async data => {
  get.mockResolvedValue({ data }); mount(); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Create reviewed asset' })).toHaveProperty('disabled', true);
});
it('retries failed review without a creation request', async () => {
  get.mockRejectedValueOnce(new Error('offline')); mount(); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Reload promotion review' })); await screen.findByRole('checkbox'); expect(post).not.toHaveBeenCalled();
});
it('ignores a creation result after unmount', async () => {
  let resolve!: (value: unknown) => void; post.mockReturnValue(new Promise(r => { resolve = r; }));
  const view = mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed asset' })); view.unmount();
  await act(async () => resolve({ data: result })); expect(onPromoted).not.toHaveBeenCalled();
});
