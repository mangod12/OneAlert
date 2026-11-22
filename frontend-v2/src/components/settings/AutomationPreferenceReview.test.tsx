import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { AutomationPanel } from './AutomationPanel';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get), patch = vi.mocked(apiClient.patch);
const prefs = { auto_escalate_incidents: true, auto_escalate_min_alerts: 4, auto_escalate_min_severity: 'high', sla_due_dates_enabled: true, auto_assign_new_alerts: false, sla_days_critical: 1, sla_days_high: 3, sla_days_medium: 7, sla_days_low: 14, sla_days_info: 30 };
const path = '/auth/me/automation-preferences';
const current = () => screen.getByLabelText('Auto-escalate noisy incidents to an investigation');
const save = () => screen.getByRole('button', { name: 'Save automation' });
const confirm = () => screen.getByRole('button', { name: 'Confirm reviewed preferences' });
const reads = () => get.mock.calls.filter(([url]) => url === path);
beforeEach(() => {
  vi.resetAllMocks(); get.mockImplementation(async url => ({ data: url === path ? prefs : url === '/orgs/me/on-call' ? { member_ids: [], anchor_date: null, current_member_id: null } : [] }));
  patch.mockImplementation(async (_url, body) => ({ data: body }));
});
afterEach(cleanup);
async function loaded() { const view = render(<AutomationPanel />); await screen.findByLabelText('Auto-escalate noisy incidents to an investigation'); return view; }
async function review() { await loaded(); fireEvent.change(screen.getByLabelText('Active alerts on one asset'), { target: { value: '6' } }); fireEvent.click(save()); await screen.findByLabelText('Automation preference change review'); }
it('shows unknown loading state without editable defaults or save controls until the complete read arrives', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementation(url => url === path ? new Promise(done => { resolve = done; }) : Promise.resolve({ data: [] }));
  render(<AutomationPanel />); expect(screen.queryByLabelText('Auto-escalate noisy incidents to an investigation')).toBeNull(); expect(screen.queryByRole('button', { name: 'Save automation' })).toBeNull(); expect(screen.getByRole('status').textContent).toContain('No editable defaults'); expect(patch).not.toHaveBeenCalled();
  await act(async () => resolve({ data: prefs })); expect((current() as HTMLInputElement).checked).toBe(true); expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).value).toBe('4');
});
it.each([{}, { ...prefs, auto_assign_new_alerts: 'false' }, null])('refuses malformed initial reads and supports only an explicit complete reread %#', async data => {
  get.mockImplementation(async url => ({ data: url === path ? data : [] })); render(<AutomationPanel />); expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByLabelText('Auto-escalate noisy incidents to an investigation')).toBeNull(); expect(patch).not.toHaveBeenCalled();
  get.mockImplementation(async url => ({ data: url === path ? prefs : [] })); fireEvent.click(screen.getByRole('button', { name: 'Read current automation preferences' })); await screen.findByLabelText('Auto-escalate noisy incidents to an investigation'); expect(patch).not.toHaveBeenCalled();
});
it('keeps failed initial reads unavailable rather than turning defaults into writable state', async () => {
  get.mockImplementation(async url => { if (url === path) throw Error('PRIVATE_SERVER_ERROR'); return { data: [] }; }); render(<AutomationPanel />); expect((await screen.findByRole('alert')).textContent).toContain('No defaults'); expect(document.body.textContent).not.toContain('PRIVATE_SERVER_ERROR'); expect(screen.queryByRole('button', { name: 'Save automation' })).toBeNull(); expect(reads()).toHaveLength(1); expect(patch).not.toHaveBeenCalled();
});
it('does not send unchanged preferences or write during draft/review/cancel', async () => {
  await loaded(); fireEvent.click(save()); expect(screen.getByText(/No preference changes/)).toBeTruthy(); expect(patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('High (days)'), { target: { value: '5' } }); fireEvent.click(save()); const region = screen.getByLabelText('Automation preference change review'); expect(region.textContent).toContain('High SLA days'); expect(region.textContent).toContain('3 to 5'); expect(patch).not.toHaveBeenCalled(); expect(reads()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preference review' })); expect(screen.queryByLabelText('Automation preference change review')).toBeNull(); expect(patch).not.toHaveBeenCalled();
});
it('invalidates a previous review as soon as a draft changes', async () => {
  await review(); fireEvent.change(screen.getByLabelText('Active alerts on one asset'), { target: { value: '7' } }); expect(screen.queryByLabelText('Automation preference change review')).toBeNull(); expect(patch).not.toHaveBeenCalled();
});
it('rechecks the exact baseline and writes only once after explicit confirmation with a matching response', async () => {
  await review(); const button = confirm(); fireEvent.click(button); fireEvent.click(button);
  await screen.findByText(/The save response matches your reviewed preferences/); expect(reads()).toHaveLength(2); expect(patch).toHaveBeenCalledTimes(1); expect(patch).toHaveBeenCalledWith(path, { ...prefs, auto_escalate_min_alerts: 6 }); expect(screen.queryByLabelText('Automation preference change review')).toBeNull();
});
it('detects a changed baseline without overwriting it, retains the draft and requires a new review', async () => {
  await review(); const changed = { ...prefs, sla_days_high: 5 }; get.mockImplementation(async url => ({ data: url === path ? changed : [] }));
  fireEvent.click(confirm()); await screen.findByText(/Current preferences changed since your read/); expect(patch).not.toHaveBeenCalled(); expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).value).toBe('6'); expect((screen.getByLabelText('High (days)') as HTMLInputElement).value).toBe('3');
  fireEvent.click(save()); expect(screen.getByLabelText('Automation preference change review').textContent).toContain('5 to 3'); expect(patch).not.toHaveBeenCalled();
});
it('does not patch after an unverifiable preflight and requires a new complete read', async () => {
  await review(); get.mockImplementation(async url => { if (url === path) throw Error('PRIVATE_CHECK_FAILURE'); return { data: [] }; }); fireEvent.click(confirm());
  expect((await screen.findByRole('alert')).textContent).toContain('No save request was sent'); expect(patch).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Save automation' })).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE_CHECK_FAILURE');
});
it.each(['reject', 'incomplete', 'different'])('treats an ambiguous %s save as unknown, never retries or claims success', async mode => {
  await review(); if (mode === 'reject') patch.mockRejectedValueOnce(Error('PRIVATE_WRITE_FAILURE')); else patch.mockResolvedValueOnce({ data: mode === 'incomplete' ? {} : { ...prefs, auto_escalate_min_alerts: 8 } });
  fireEvent.click(confirm()); expect((await screen.findByRole('alert')).textContent).toContain('may already have applied'); expect(patch).toHaveBeenCalledTimes(1); expect(reads()).toHaveLength(2); expect(screen.queryByRole('button', { name: 'Save automation' })).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE_WRITE_FAILURE');
  get.mockImplementation(async url => ({ data: url === path ? { ...prefs, auto_escalate_min_alerts: 6 } : [] })); fireEvent.click(screen.getByRole('button', { name: 'Read current automation preferences' })); await screen.findByLabelText('Active alerts on one asset'); expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).value).toBe('6'); expect(patch).toHaveBeenCalledTimes(1);
});
it('never writes a preflight result after the panel has unmounted', async () => {
  const view = await loaded(); fireEvent.change(screen.getByLabelText('Active alerts on one asset'), { target: { value: '6' } }); fireEvent.click(save()); let resolve!: (value: unknown) => void;
  get.mockImplementation(url => url === path ? new Promise(done => { resolve = done; }) : Promise.resolve({ data: [] })); fireEvent.click(confirm()); await waitFor(() => expect(reads()).toHaveLength(2)); view.unmount(); await act(async () => resolve({ data: prefs })); expect(patch).not.toHaveBeenCalled();
});
it('discards older initial loads in StrictMode without showing their values', async () => {
  const pending: ((value: unknown) => void)[] = []; get.mockImplementation(url => url === path ? new Promise(done => pending.push(done)) : Promise.resolve({ data: [] }));
  render(<StrictMode><AutomationPanel /></StrictMode>); expect(pending).toHaveLength(2); await act(async () => pending[1]({ data: prefs })); await screen.findByLabelText('Active alerts on one asset'); await act(async () => pending[0]({ data: { ...prefs, auto_escalate_min_alerts: 19 } })); expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).value).toBe('4'); expect(patch).not.toHaveBeenCalled();
});
