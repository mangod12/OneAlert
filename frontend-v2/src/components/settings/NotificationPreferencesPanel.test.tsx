import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get), patch = vi.mocked(apiClient.patch), path = '/auth/me/notification-preferences';
const prefs = { email_notifications_enabled: true, notify_min_severity: 'high', muted_kinds: ['alert_created'], quiet_hours_start: '22:00', quiet_hours_end: '06:00', digest_enabled: true, digest_hour_utc: 7 };
const save = () => screen.getByRole('button', { name: 'Review notification changes' });
const confirm = () => screen.getByRole('button', { name: 'Confirm reviewed notification preferences' });
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: prefs }); patch.mockImplementation(async (_url, data) => ({ data })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (data: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function loaded() { render(<NotificationPreferencesPanel />); await screen.findByRole('button', { name: 'Review notification changes' }); }
async function review() { await loaded(); fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'critical' } }); fireEvent.click(save()); await screen.findByRole('region', { name: 'Notification preference change review' }); }
it('offers no editable defaults or save before a complete saved read succeeds', async () => {
  const pending = deferred<{ data: unknown }>(); get.mockReturnValueOnce(pending.promise); render(<NotificationPreferencesPanel />); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'Review notification changes' })).toBeNull(); await act(async () => pending.resolve({ data: prefs })); await screen.findByLabelText('Minimum severity'); expect(patch).not.toHaveBeenCalled();
});
it.each(['offline', 'incomplete', 'unknown kind', 'legacy minimum', 'incomplete quiet pair'])('fails closed on a bad saved read: %s', async mode => {
  if (mode === 'offline') get.mockRejectedValueOnce(Error('PRIVATE_ERROR')); else get.mockResolvedValueOnce({ data: mode === 'incomplete' ? {} : { ...prefs, ...(mode === 'unknown kind' ? { muted_kinds: ['private_unsupported'] } : mode === 'legacy minimum' ? { notify_min_severity: 'legacy' } : { quiet_hours_end: null }) } });
  render(<NotificationPreferencesPanel />); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'Review notification changes' })).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE_ERROR'); expect(patch).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Read current notification preferences' })); await screen.findByLabelText('Minimum severity');
});
it('does not send unchanged drafts, review or canceled changes', async () => {
  await loaded(); fireEvent.click(save()); await screen.findByText('No notification preference changes to review. Nothing was sent.'); expect(patch).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'critical' } }); fireEvent.click(save()); const region=await screen.findByRole('region', { name: 'Notification preference change review' }); expect(region.textContent).toContain('high to critical'); expect(region.textContent).toContain('Complete seven-field proposal'); expect(get).toHaveBeenCalledTimes(1); expect(patch).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Cancel notification review' })); expect(screen.queryByRole('region', { name: 'Notification preference change review' })).toBeNull();
});
it('invalidates review immediately when any draft input changes', async () => { await review(); fireEvent.change(screen.getByLabelText('From'), { target: { value: '21:00' } }); expect(screen.queryByRole('region', { name: 'Notification preference change review' })).toBeNull(); expect(patch).not.toHaveBeenCalled(); });
it('checks saved values again and sends the exact complete proposal once', async () => {
  await review(); const button=confirm(); fireEvent.click(button); fireEvent.click(button); await screen.findByText(/The save response matches your reviewed notification preferences/); expect(get).toHaveBeenCalledTimes(2); expect(patch).toHaveBeenCalledExactlyOnceWith(path, { ...prefs, notify_min_severity: 'critical' }); expect(screen.queryByRole('region', { name: 'Notification preference change review' })).toBeNull();
});
it('preserves the draft on a changed baseline and requires another review, without writing', async () => {
  await review(); get.mockResolvedValueOnce({ data: { ...prefs, digest_hour_utc: 8 } }); fireEvent.click(confirm()); await screen.findByText(/Saved notification preferences changed since your read/); expect(patch).not.toHaveBeenCalled(); expect((screen.getByLabelText('Minimum severity') as HTMLSelectElement).value).toBe('critical'); fireEvent.click(save()); expect(screen.getByRole('region', { name: 'Notification preference change review' }).textContent).toContain('8 to 7');
});
it('accepts a current mute-list reordering but preserves the exact reviewed complete request', async () => {
  const baseline={ ...prefs, muted_kinds: ['case_mention','alert_created'] }; get.mockResolvedValue({ data: baseline }); await review(); get.mockResolvedValueOnce({ data: { ...baseline, muted_kinds: [...baseline.muted_kinds].reverse() } }); fireEvent.click(confirm()); await screen.findByText(/The save response matches/); expect(patch).toHaveBeenCalledExactlyOnceWith(path,{ ...baseline, notify_min_severity:'critical' });
});
it('does not send when a fresh baseline check fails and requires explicit reread', async () => {
  await review(); get.mockRejectedValueOnce(Error('PRIVATE_CHECK')); fireEvent.click(confirm()); await screen.findByRole('alert'); expect(patch).not.toHaveBeenCalled(); expect(screen.queryByRole('checkbox')).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE_CHECK'); fireEvent.click(screen.getByRole('button',{name:'Read current notification preferences'})); await screen.findByLabelText('Minimum severity');
});
it.each(['rejected', 'incomplete', 'contradictory'])('refuses an unknown or unverifiable save outcome without retry: %s', async mode => {
  await review(); if(mode==='rejected') patch.mockRejectedValueOnce(Error('PRIVATE_SAVE')); else patch.mockResolvedValueOnce({data:mode==='incomplete'?{}:{...prefs,notify_min_severity:'low'}}); fireEvent.click(confirm()); await screen.findByText(/The save outcome could not be verified/); expect(patch).toHaveBeenCalledTimes(1); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('region',{name:'Notification preference change review'})).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE_SAVE');
});
it('blocks duplicate requests and draft changes during confirmation, and ignores a response after unmount', async () => {
  await review(); const pending=deferred<{data:unknown}>(); get.mockReturnValueOnce(pending.promise); fireEvent.click(confirm()); expect(screen.getByLabelText('Minimum severity').closest('fieldset')?.disabled).toBe(true); expect((screen.getByRole('button',{name:'Checking and saving notification preferences...'}) as HTMLButtonElement).disabled).toBe(true); cleanup(); await act(async()=>pending.resolve({data:prefs})); expect(patch).not.toHaveBeenCalled();
});
it('does not coerce incomplete quiet-time drafts or silently clear an existing window', async()=>{
  await loaded(); fireEvent.change(screen.getByLabelText('From'),{target:{value:''}}); fireEvent.click(save()); await screen.findByText(/either two complete UTC quiet times or neither/); expect(patch).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button',{name:'Clear'})); fireEvent.click(save()); const region=screen.getByRole('region',{name:'Notification preference change review'}); expect(within(region).getAllByText(/Not set/).length).toBeGreaterThan(0); fireEvent.click(confirm()); await screen.findByText(/The save response matches/); expect(patch).toHaveBeenCalledExactlyOnceWith(path,{...prefs,quiet_hours_start:null,quiet_hours_end:null});
});
it('can review every real task/SLA mute kind already offered by Settings',async()=>{
 await loaded(); for(const name of ['Task assignments','Task due soon','Task overdue','Alert SLA breaches','Alert SLA due soon']) fireEvent.click(screen.getByRole('checkbox',{name})); fireEvent.click(save()); fireEvent.click(confirm()); await screen.findByText(/The save response matches/); expect(patch).toHaveBeenCalledExactlyOnceWith(path,{...prefs,muted_kinds:['alert_created','case_task_assigned','case_task_due_soon','case_task_overdue','alert_sla_breached','alert_sla_due_soon']});
});
