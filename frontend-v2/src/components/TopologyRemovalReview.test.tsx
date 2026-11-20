import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { TopologyRemovalReview } from './TopologyRemovalReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), del = vi.mocked(apiClient.delete), close = vi.fn(), removed = vi.fn();
const snapshot = { connection: { id: 99, source_ip: '10.0.0.7', target_ip: '10.0.0.8', protocol: 'modbus', bytes_transferred: '9007199254740993', port: 0, is_encrypted: false }, reviewed_fingerprint: 'a'.repeat(64), retrieved_at: 'now' };
const show = () => render(<TopologyRemovalReview connectionId={99} onClose={close} onRemoved={removed} />);
const acknowledge = async () => fireEvent.click(await screen.findByRole('checkbox'));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); del.mockResolvedValue({ status: 204 }); }); afterEach(cleanup);
it('requires fresh exact evidence and acknowledgement before guarded removal', async () => {
  show(); expect(screen.getByRole('button', { name: 'Remove reviewed saved connection' })).toHaveProperty('disabled', true); await screen.findByText('9007199254740993'); expect(screen.getByText('0')).toBeTruthy(); expect(screen.getByText('No')).toBeTruthy(); await acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed saved connection' })); await waitFor(() => expect(removed).toHaveBeenCalledOnce()); expect(del).toHaveBeenCalledExactlyOnceWith('/topology/connections/99', { params: { reviewed_fingerprint: 'a'.repeat(64) } });
});
it.each([{ ...snapshot, connection: { ...snapshot.connection, id: 98 } }, { ...snapshot, reviewed_fingerprint: 'bad' }, { ...snapshot, connection: { ...snapshot.connection, bytes_transferred: 9007199254740992 } }])('blocks mismatched or lossy review %#', async data => {
  get.mockResolvedValue({ data }); show(); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Remove reviewed saved connection' })).toHaveProperty('disabled', true); expect(del).not.toHaveBeenCalled();
});
it.each([409, 500])('requires fresh evidence and new acknowledgement after status %s', async status => {
  del.mockRejectedValueOnce({ response: { status, data: { detail: 'Reload review' } } }); show(); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed saved connection' })); await screen.findByRole('alert'); expect(removed).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Remove reviewed saved connection' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload connection removal review' })); await screen.findByRole('checkbox'); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed saved connection' })); await waitFor(() => expect(removed).toHaveBeenCalledOnce());
});
it('does not accept a 200 response as deletion acknowledgement', async () => {
  del.mockResolvedValueOnce({ status: 200 }); show(); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed saved connection' })); await screen.findByRole('alert'); expect(removed).not.toHaveBeenCalled();
});
it('blocks duplicate writes, cancel and Escape while removal is pending', async () => {
  let resolve!: (value: unknown) => void; del.mockReturnValueOnce(new Promise(r => { resolve = r; })); show(); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Remove reviewed saved connection' })); fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Cancel connection removal' })); expect(close).not.toHaveBeenCalled(); expect(del).toHaveBeenCalledOnce();
  await act(async () => resolve({ status: 204 })); expect(removed).toHaveBeenCalledOnce();
});
it('lets a failed evidence read be retried without any removal call', async () => {
  get.mockRejectedValueOnce(new Error('offline')); show(); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Reload connection removal review' })); await screen.findByRole('checkbox'); expect(del).not.toHaveBeenCalled();
});
