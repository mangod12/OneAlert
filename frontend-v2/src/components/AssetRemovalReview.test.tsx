import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssetRemovalReview } from './AssetRemovalReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), remove = vi.mocked(apiClient.delete), onDeleted = vi.fn(), onClose = vi.fn();
const review = { asset_id: 7, name: 'Gateway', asset_type: 'hardware', criticality: 'high', is_ot_asset: true, dependencies: { alerts: 0, sboms: 0, discovered_devices: 0, suppression_rules: 0 }, can_delete: true, reviewed_fingerprint: 'a'.repeat(64) };
const mount = () => render(<AssetRemovalReview id={7} onDeleted={onDeleted} onClose={onClose} />);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: review }); remove.mockResolvedValue({ status: 204 }); });
afterEach(cleanup);
it('checks exact current dependencies and requires explicit acknowledgement', async () => {
  mount(); await screen.findByText('Asset #7: Gateway');
  expect(get).toHaveBeenCalledExactlyOnceWith('/assets/7/removal-review');
  const button = screen.getByRole('button', { name: 'Remove reviewed asset' });
  expect(button).toHaveProperty('disabled', true); fireEvent.click(button); expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  expect(remove).toHaveBeenCalledExactlyOnceWith('/assets/7', { params: { reviewed_fingerprint: 'a'.repeat(64) } });
});
it.each(['alerts', 'sboms', 'discovered_devices', 'suppression_rules'])('blocks removal when %s references remain', async key => {
  get.mockResolvedValue({ data: { ...review, can_delete: false, dependencies: { ...review.dependencies, [key]: 2 } } });
  mount(); await screen.findByText(/Removal blocked/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Remove reviewed asset' })).toHaveProperty('disabled', true);
  expect(remove).not.toHaveBeenCalled();
});
it('retains the review after conflict, blocks another write, and clears acknowledgement on reload', async () => {
  remove.mockRejectedValue(new Error('New linked records'));
  mount(); await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed asset' })); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Remove reviewed asset' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload removal review' }));
  await screen.findByRole('checkbox'); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
  expect(remove).toHaveBeenCalledTimes(1);
});
it('does not treat an unexpected response as a confirmed removal', async () => {
  remove.mockResolvedValue({ status: 200 }); mount(); await screen.findByRole('checkbox');
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed asset' }));
  await screen.findByRole('alert'); expect(onDeleted).not.toHaveBeenCalled();
});
it('blocks duplicate submissions and Escape/cancel/reload while pending', async () => {
  let resolve!: (value: unknown) => void; remove.mockReturnValue(new Promise(r => { resolve = r; }));
  mount(); await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox'));
  const button = screen.getByRole('button', { name: 'Remove reviewed asset' }); fireEvent.click(button); fireEvent.click(button);
  fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Reload removal review' })).toHaveProperty('disabled', true);
  await act(async () => resolve({ status: 204 })); expect(onDeleted).toHaveBeenCalledTimes(1);
});
it('ignores a deletion result after unmount', async () => {
  let resolve!: (value: unknown) => void; remove.mockReturnValue(new Promise(r => { resolve = r; }));
  const view = mount(); await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed asset' })); view.unmount();
  await act(async () => resolve({ status: 204 })); expect(onDeleted).not.toHaveBeenCalled();
});
it.each([
  { ...review, asset_id: 8 }, { ...review, reviewed_fingerprint: '' },
  { ...review, can_delete: true, dependencies: { ...review.dependencies, alerts: 1 } },
  { ...review, dependencies: { ...review.dependencies, sboms: -1 } },
])('rejects an unverifiable removal review %#', async data => {
  get.mockResolvedValue({ data }); mount(); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Remove reviewed asset' })).toHaveProperty('disabled', true); expect(remove).not.toHaveBeenCalled();
});
it('retries a failed dependency read without any writes', async () => {
  get.mockRejectedValueOnce(new Error('offline')); mount(); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Reload removal review' })); await screen.findByRole('checkbox'); expect(remove).not.toHaveBeenCalled();
});
