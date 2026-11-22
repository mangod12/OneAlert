import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { notificationPolicyFixture } from '../../utils/notificationPolicyPreview.fixture';
import { type NotificationPolicyRequest, type SavedNotificationPreferences } from '../../utils/notificationPolicyPreview';
import { NotificationPolicyPreview } from './NotificationPolicyPreview';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function open(overrides: Partial<SavedNotificationPreferences> = {}, selected: Partial<NotificationPolicyRequest> = {}) {
  const fixture = await notificationPolicyFixture(overrides, selected); get.mockResolvedValue({ data: fixture.base }); post.mockResolvedValue({ data: fixture.preview }); render(<NotificationPolicyPreview />); expect(get).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Inspect saved delivery policy' })); await screen.findByRole('region', { name: 'Verified saved notification preferences' });
  fireEvent.change(screen.getByLabelText('UTC clock time'), { target: { value: fixture.request.utc_time ?? '' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Event path' }), { target: { value: fixture.request.scenario } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Event severity' }), { target: { value: fixture.request.severity ?? 'unknown' } });
  return fixture;
}
const testPolicy = () => fireEvent.click(screen.getByRole('button', { name: 'Test saved policy, send nothing' }));
it('reads lazily, tests only the frozen saved snapshot and explains muted-kind/new-alert/quiet distinctions without sending', async () => {
  const fixture = await open(); expect(get).toHaveBeenCalledExactlyOnceWith('/notifications/policy-review'); expect(post).not.toHaveBeenCalled(); testPolicy(); await screen.findByRole('region', { name: 'Verified preference predicate outcome' });
  expect(post).toHaveBeenCalledExactlyOnceWith('/notifications/policy-preview', { expected_fingerprint: fixture.base.preferences_fingerprint, ...fixture.request }); expect(screen.getByText('Filtered by the saved preference predicate')).toBeTruthy(); expect(screen.getByText(/Muted kinds affect the feed but are not consulted by this email predicate/)).toBeTruthy(); expect(screen.getByRole('region', { name: 'Verified severity comparison' }).textContent).toContain('Unknown / unclassified'); expect(screen.getByRole('region', { name: 'Policy preview limits' }).textContent).toContain('Digest rules');
});
it('keeps investigation kind mutes and the global email toggle in force for critical events', async () => {
  await open({ email_notifications_enabled: false }, { scenario: 'case_assigned', severity: 'critical' }); testPolicy(); const outcome = within(await screen.findByRole('region', { name: 'Verified preference predicate outcome' })); expect(outcome.getByText('Email notifications are disabled.')).toBeTruthy(); expect(outcome.getByText('This event kind is muted for the investigation dispatch predicate.')).toBeTruthy(); expect(screen.getByText(/Recipient selection and channel configuration are not checked/)).toBeTruthy();
});
it('labels chosen UTC clocks and unknown severity without predicting delivery', async () => {
  await open({}, { severity: null }); testPolicy(); await screen.findByText(/23:00 UTC \(chosen hypothetical clock\)/); expect(screen.getByText(/Unknown severity passes the minimum gate/)).toBeTruthy();
});
it('can test the server current UTC minute with no browser-local conversion', async () => {
  const fixture = await open({}, { utc_time: null }); testPolicy(); await screen.findByText(/18:00 UTC \(server current clock\)/); expect(post).toHaveBeenCalledExactlyOnceWith('/notifications/policy-preview', { expected_fingerprint: fixture.base.preferences_fingerprint, ...fixture.request });
});
it('clears old results immediately when a hypothetical input changes and requires a new explicit test', async () => {
  await open(); testPolicy(); await screen.findByRole('region', { name: 'Verified severity comparison' }); fireEvent.change(screen.getByRole('combobox', { name: 'Event severity' }), { target: { value: 'critical' } }); expect(screen.queryByRole('region', { name: 'Verified preference predicate outcome' })).toBeNull(); expect(screen.queryByRole('region', { name: 'Verified severity comparison' })).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
it.each(['bad hash', 'unsupported saved values', 'offline', 'no hashing'])('shows no simulation when the saved snapshot is unverifiable: %s', async mode => {
  const fixture = await notificationPolicyFixture(); if (mode === 'bad hash') fixture.base.preferences_fingerprint = '0'.repeat(64); if (mode === 'unsupported saved values') fixture.base.preferences.quiet_hours_start = '22:00\n'; if (mode === 'no hashing') vi.stubGlobal('crypto', {}); if (mode === 'offline') get.mockRejectedValueOnce(Error('Offline')); else get.mockResolvedValueOnce({ data: fixture.base }); render(<NotificationPolicyPreview />); fireEvent.click(screen.getByRole('button', { name: 'Inspect saved delivery policy' })); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Test saved policy, send nothing' })).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it.each(['stale', 'offline', 'wrong predicate', 'wrong allowed', 'bad matrix'])('clears verified evidence after an invalid or failed preview and waits for explicit reread: %s', async mode => {
  const fixture = await open(); if (mode === 'stale' || mode === 'offline') post.mockRejectedValueOnce({ response: { status: mode === 'stale' ? 409 : 503 } }); else { if (mode === 'wrong predicate') fixture.preview.predicate = 'investigation_dispatch'; if (mode === 'wrong allowed') fixture.preview.selected.allowed_by_preference_predicate = true; if (mode === 'bad matrix') fixture.preview.severity_matrix = []; post.mockResolvedValueOnce({ data: fixture.preview }); }
  testPolicy(); await screen.findByRole('alert'); expect(screen.queryByRole('region', { name: 'Verified severity comparison' })).toBeNull(); expect(screen.queryByRole('region', { name: 'Verified saved notification preferences' })).toBeNull(); expect(get).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Read current saved policy' })); await screen.findByRole('region', { name: 'Verified saved notification preferences' }); expect(post).toHaveBeenCalledTimes(1);
});
it('disables input changes and duplicate simulation requests while a read-only preview is pending but permits closing', async () => {
  const fixture = await open(), pending = deferred<{ data: unknown }>(); post.mockReturnValueOnce(pending.promise); testPolicy(); fireEvent.click(screen.getByRole('button', { name: 'Checking saved preference predicate...' })); expect(post).toHaveBeenCalledTimes(1); expect(screen.getByRole('combobox', { name: 'Event path' }).closest('fieldset')?.disabled).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Close policy inspector' })); expect(screen.queryByRole('dialog')).toBeNull(); await act(async () => pending.resolve({ data: fixture.preview })); expect(screen.queryByRole('region', { name: 'Verified preference predicate outcome' })).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
it('ignores a late saved-policy read after closing the dialog', async () => {
  const fixture = await notificationPolicyFixture(), pending = deferred<{ data: unknown }>(); get.mockReturnValueOnce(pending.promise); render(<NotificationPolicyPreview />); fireEvent.click(screen.getByRole('button', { name: 'Inspect saved delivery policy' })); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); await act(async () => pending.resolve({ data: fixture.base })); expect(post).not.toHaveBeenCalled();
});
it('clears old snapshot and matrix on a failed explicit refresh', async () => {
  await open(); testPolicy(); await screen.findByRole('region', { name: 'Verified severity comparison' }); get.mockRejectedValueOnce(Error('Offline')); fireEvent.click(screen.getByRole('button', { name: 'Read current saved policy' })); await screen.findByRole('alert'); expect(screen.queryByRole('region', { name: 'Verified severity comparison' })).toBeNull(); expect(screen.queryByRole('region', { name: 'Verified saved notification preferences' })).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
it('shows the actual legacy minimum fallback without changing the saved preference', async () => { await open({ notify_min_severity: 'legacy' }); testPolicy(); await screen.findByText(/runtime uses its medium fallback/); expect(screen.getByRole('region', { name: 'Verified saved notification preferences' }).textContent).toContain('legacy'); expect(post).toHaveBeenCalledTimes(1); });
