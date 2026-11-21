import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { NotificationBatchReview } from './NotificationBatchReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), applied = vi.fn(), busy = vi.fn();
const record = { id: 9, kind: 'case_assigned', title: 'Case assignment', body: 'Review recorded context before cleanup.', created_at: '2026-11-20T18:00:00Z', read_at: null };
const preview = { operation: 'mark_read', kind: null, total: 101, records: [record], fingerprint: 'a'.repeat(64) };
const props = { kind: '', unreadOnly: false, disabled: false, onApplied: applied, onBusyChange: busy };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: preview }); post.mockResolvedValue({ data: { success: true, operation: 'mark_read', affected: 1, ids: [9] } }); applied.mockResolvedValue(undefined); });
afterEach(cleanup);
function show(overrides = {}) { return render(<NotificationBatchReview {...props} {...overrides} />); }
async function load() { fireEvent.click(screen.getByRole('button', { name: 'Review matching unread notifications' })); await screen.findByRole('list', { name: 'Exact notification cleanup review' }); }
async function confirm() { await load(); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification changes' })); }
it('does not read or mutate until asked and requires exact-record review plus confirmation', async () => {
  show(); expect(get).not.toHaveBeenCalled(); await confirm(); expect(post).not.toHaveBeenCalled();
  expect(screen.getByText(record.body)).toBeTruthy(); expect(screen.getByText(/1 exact records selected from 101/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 notifications' })); await screen.findByText(/1 reviewed notifications marked read/);
  expect(post).toHaveBeenCalledExactlyOnceWith('/notifications/review-batch', { operation: 'mark_read', kind: null, ids: [9], fingerprint: 'a'.repeat(64) }); expect(applied).toHaveBeenCalledTimes(1);
});
it('binds preview and mutation to the applied kind filter and exact read records', async () => {
  get.mockResolvedValue({ data: { ...preview, operation: 'delete_read', kind: 'case_assigned', records: [{ ...record, read_at: '2026-11-20T19:00:00Z' }] } });
  post.mockResolvedValue({ data: { success: true, operation: 'delete_read', affected: 1, ids: [9] } }); show({ kind: 'case_assigned' });
  fireEvent.click(screen.getByRole('button', { name: 'Review matching read notifications for deletion' })); await screen.findByRole('list');
  expect(get).toHaveBeenCalledWith('/notifications/review-batch', { params: { operation: 'delete_read', kind: 'case_assigned' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification changes' })); expect(screen.getByRole('dialog').textContent).toContain('Permanently delete');
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 notifications' })); await screen.findByText(/1 reviewed notifications deleted/);
  expect(post).toHaveBeenCalledWith('/notifications/review-batch', { operation: 'delete_read', kind: 'case_assigned', ids: [9], fingerprint: 'a'.repeat(64) });
});
it.each([{ kind: 'other' }, { operation: 'delete_read' }, { records: [record, record] }, { records: [{ ...record, id: 0 }] }, { records: [{ ...record, read_at: 'already-read' }] }, { fingerprint: 'bad' }])('rejects mismatched or unsafe preview data %j', async overrides => {
  get.mockResolvedValue({ data: { ...preview, ...overrides } }); show(); fireEvent.click(screen.getByRole('button', { name: 'Review matching unread notifications' })); await screen.findByRole('alert');
  expect(screen.queryByRole('list')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('does not claim success on a wrong-identity mutation reply or retry automatically', async () => {
  post.mockResolvedValue({ data: { success: true, operation: 'mark_read', affected: 1, ids: [10] } }); show(); await confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 notifications' })); await screen.findByRole('alert');
  expect(screen.queryByText(/reviewed notifications marked read/)).toBeNull(); expect(screen.queryByRole('list')).toBeNull(); expect(post).toHaveBeenCalledTimes(1); expect(applied).not.toHaveBeenCalled();
});
it('discards stale reviews on filter changes and refuses new review actions while another action runs', async () => {
  const view = show(); await load(); view.rerender(<NotificationBatchReview {...props} kind="case_assigned" />); expect(screen.queryByRole('list')).toBeNull();
  view.rerender(<NotificationBatchReview {...props} disabled />); expect((screen.getByRole('button', { name: 'Review matching unread notifications' }) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps empty or failed reviews separate from an all-caught-up claim', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); show(); fireEvent.click(screen.getByRole('button', { name: 'Review matching unread notifications' })); await screen.findByRole('alert');
  get.mockResolvedValueOnce({ data: { ...preview, records: [], total: 0 } }); fireEvent.click(screen.getByRole('button', { name: 'Review matching unread notifications' })); await screen.findByText(/No notifications match this review scope/);
  expect(screen.queryByText('All caught up')).toBeNull(); expect(screen.queryByRole('button', { name: 'Confirm reviewed notification changes' })).toBeNull();
});
it('locks duplicate confirmations and requires a fresh review after conflict', async () => {
  let reject!: (error: Error) => void; post.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; })); show(); await confirm();
  const button = screen.getByRole('button', { name: 'Apply to 1 notifications' }); fireEvent.click(button); fireEvent.click(button); expect(post).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Review changed'))); await screen.findByRole('alert'); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('list')).toBeNull();
});
it('disables read-record deletion while unread-only filtering is active', () => {
  show({ unreadOnly: true }); expect((screen.getByRole('button', { name: 'Review matching read notifications for deletion' }) as HTMLButtonElement).disabled).toBe(true);
});
it('ignores a late review response after a filter remount', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show();
  fireEvent.click(screen.getByRole('button', { name: 'Review matching unread notifications' })); view.rerender(<NotificationBatchReview {...props} kind="case_assigned" />);
  await act(async () => finish({ data: preview })); expect(screen.queryByRole('list')).toBeNull(); await waitFor(() => expect(post).not.toHaveBeenCalled());
});
it('binds search preview and exact cleanup to the same literal query, discarding on search changes', async () => {
  get.mockResolvedValue({ data: { ...preview, query: '100%_match' } });
  const view = show({ query: '100%_match' }); await confirm();
  expect(get).toHaveBeenCalledWith('/notifications/review-batch', { params: { operation: 'mark_read', query: '100%_match' } });
  expect(screen.getByRole('dialog').textContent).toContain('Search text: 100%_match');
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 notifications' })); await screen.findByText(/1 reviewed notifications marked read/);
  expect(post).toHaveBeenCalledWith('/notifications/review-batch', { operation: 'mark_read', kind: null, ids: [9], fingerprint: 'a'.repeat(64), query: '100%_match' });
  await load(); view.rerender(<NotificationBatchReview {...props} query="changed" />); expect(screen.queryByRole('list')).toBeNull();
});
it('rejects a preview whose search scope was omitted or changed', async () => {
  show({ query: 'saved match' }); fireEvent.click(screen.getByRole('button', { name: 'Review matching unread notifications' })); await screen.findByRole('alert'); expect(screen.queryByRole('list')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
