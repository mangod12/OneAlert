import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { suppressionEditFixture } from '../../utils/suppressionEditReview.fixture';
import { suppressionRuleFingerprint } from '../../utils/suppressionStatusReview';
import { SuppressionEditReview } from './SuppressionEditReview';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), saved = vi.fn(), close = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const show = (ruleId = 7) => render(<SuppressionEditReview ruleId={ruleId} onClose={close} onSaved={saved} />);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function start(overrides = {}) {
  const fixture = await suppressionEditFixture(overrides); get.mockResolvedValue({ data: fixture.base }); post.mockResolvedValueOnce({ data: fixture.preview });
  const mounted = show(); const input = await screen.findByRole('textbox', { name: 'Title contains, literal and case-insensitive' }); fireEvent.change(input, { target: { value: fixture.proposal.title_contains } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview exact saved-rule edit' })); await screen.findByRole('button', { name: 'Confirm reviewed rule edit' }); return { ...fixture, mounted };
}
it.each([false, true])('edits only an explicitly reviewed frozen proposal while preserving enabled=%s and identity', async enabled => {
  const fixture = await start({ enabled }); expect(post).toHaveBeenCalledTimes(1); expect(post).toHaveBeenNthCalledWith(1, '/suppression-rules/7/edit-preview', { expected_fingerprint: fixture.base.rule_fingerprint, proposal: fixture.proposal });
  expect(screen.getByText(enabled ? /enabled and will remain enabled/ : /paused and will remain paused/)).toBeTruthy(); expect(document.querySelector('script')).toBeNull();
  expect(screen.getByRole('region', { name: 'Exact reviewed saved-value changes' }).textContent).toContain('old Ä%_');
  fireEvent.click(screen.getByText('Match proposed criteria only: 1 current examples'));
  expect(screen.getByRole('link', { name: 'Open exact current alert #92' }).getAttribute('href')).toBe('/app/alerts?alert=92');
  expect(screen.getByRole('link', { name: 'Inspect saved-current overlap, not this draft' }).getAttribute('href')).toBe('/app/settings/suppression-rules/7/overlap');
  post.mockResolvedValueOnce({ data: fixture.result }); const confirm = screen.getByRole('button', { name: 'Confirm reviewed rule edit' }); fireEvent.click(confirm); fireEvent.click(confirm);
  await screen.findByText(/conditional edit was confirmed/); expect(post).toHaveBeenCalledTimes(2); expect(post).toHaveBeenLastCalledWith('/suppression-rules/7/reviewed-edit', { expected_fingerprint: fixture.base.rule_fingerprint, proposal: fixture.proposal }); expect(saved).toHaveBeenCalledExactlyOnceWith(fixture.result.rule); expect(screen.queryByRole('button', { name: 'Confirm reviewed rule edit' })).toBeNull();
});
it('keeps local invalid drafts and no-ops from even requesting a preview', async () => {
  const fixture = await suppressionEditFixture(); get.mockResolvedValue({ data: fixture.base }); show(); await screen.findByRole('textbox', { name: 'Rule name' }); fireEvent.click(screen.getByRole('button', { name: 'Preview exact saved-rule edit' })); await screen.findByText(/Change at least one saved value/); expect(post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Snooze hours' }), { target: { value: '1.5' } }); fireEvent.click(screen.getByRole('button', { name: 'Preview exact saved-rule edit' })); await screen.findByText(/whole number from 1 to 720/); expect(post).not.toHaveBeenCalled();
});
it('requires a new preview after going back to change a draft', async () => {
  await start(); fireEvent.click(screen.getByRole('button', { name: 'Back to draft' })); expect(screen.queryByRole('button', { name: 'Confirm reviewed rule edit' })).toBeNull(); expect((screen.getByRole('textbox', { name: 'Title contains, literal and case-insensitive' }) as HTMLInputElement).value).toBe('new Ä%_'); expect(post).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
});
it('blocks close, Escape, reread and duplicate confirmations while saving, and never claims early success', async () => {
  const fixture = await start(), pending = deferred<{ data: unknown }>(); post.mockReturnValueOnce(pending.promise); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed rule edit' })); fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Close edit review' })); expect(close).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled(); expect((screen.getByRole('button', { name: 'Discard draft and read current rule' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => pending.resolve({ data: fixture.result })); await screen.findByText(/conditional edit was confirmed/); expect(saved).toHaveBeenCalledTimes(1);
});
it.each(['bad base hash', 'wrong ID', 'missing saved field', 'no hashing'])('cannot offer editing after an unverified current read: %s', async mode => {
  const fixture = await suppressionEditFixture();
  if (mode === 'bad base hash') fixture.base.rule_fingerprint = '0'.repeat(64);
  if (mode === 'wrong ID') fixture.base.rule.id = 8;
  if (mode === 'missing saved field') delete (fixture.base.rule as Partial<typeof fixture.rule>).title_contains;
  if (mode === 'no hashing') vi.stubGlobal('crypto', {});
  get.mockResolvedValue({ data: fixture.base }); show(); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Preview exact saved-rule edit' })).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it.each(['bad proposal hash', 'different proposal', 'bad counts', 'offline', 'cap', 'stale'])('clears draft evidence after an invalid or failed preview and requires explicit reread: %s', async mode => {
  const fixture = await suppressionEditFixture(); get.mockResolvedValue({ data: fixture.base });
  if (mode === 'bad proposal hash') fixture.preview.proposed_rule_fingerprint = '0'.repeat(64);
  if (mode === 'different proposal') { fixture.preview.proposed_rule.name = 'Unreviewed name'; fixture.preview.proposed_rule_fingerprint = await suppressionRuleFingerprint(fixture.preview.proposed_rule); }
  if (mode === 'bad counts') fixture.preview.counts.added = 999;
  if (['offline', 'cap', 'stale'].includes(mode)) post.mockRejectedValueOnce({ response: { status: mode === 'cap' ? 422 : mode === 'stale' ? 409 : 503 } }); else post.mockResolvedValueOnce({ data: fixture.preview });
  show(); fireEvent.change(await screen.findByRole('textbox', { name: 'Title contains, literal and case-insensitive' }), { target: { value: fixture.proposal.title_contains } }); fireEvent.click(screen.getByRole('button', { name: 'Preview exact saved-rule edit' })); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Confirm reviewed rule edit' })).toBeNull(); expect(screen.queryByRole('region', { name: 'Current selected-criteria match delta' })).toBeNull(); expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
});
it.each(['offline', 'not conditional', 'changed enabled', 'wrong hash', 'stale'])('treats an unverified write outcome as unknown without retry: %s', async mode => {
  const fixture = await start();
  if (mode === 'offline' || mode === 'stale') post.mockRejectedValueOnce({ response: { status: mode === 'stale' ? 409 : 503 } });
  else { if (mode === 'not conditional') fixture.result.conditional_update_applied = false; if (mode === 'wrong hash') fixture.result.rule_fingerprint = '0'.repeat(64); if (mode === 'changed enabled') { fixture.result.rule.enabled = true; fixture.result.rule_fingerprint = await suppressionRuleFingerprint(fixture.result.rule); } post.mockResolvedValueOnce({ data: fixture.result }); }
  fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed rule edit' })); const alert = await screen.findByRole('alert'); expect(alert.textContent).toContain(mode === 'stale' ? 'No edit was made for this request' : 'may already have applied'); expect(saved).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(2); expect(get).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: 'Confirm reviewed rule edit' })).toBeNull();
  get.mockResolvedValueOnce({ data: fixture.base }); fireEvent.click(screen.getByRole('button', { name: 'Read current saved rule' })); await screen.findByRole('textbox', { name: 'Rule name' }); expect(post).toHaveBeenCalledTimes(2);
});
it('discards the draft only on the explicitly labeled reread, and invalid refresh clears old data', async () => {
  await start(); get.mockRejectedValueOnce(Error('Offline')); fireEvent.click(screen.getByRole('button', { name: 'Discard draft and read current rule' })); await screen.findByRole('alert'); expect(screen.queryByRole('region', { name: 'Exact reviewed saved-value changes' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Confirm reviewed rule edit' })).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
it('does not apply a late saved read after navigation', async () => {
  const fixture = await suppressionEditFixture(), pending = deferred<{ data: unknown }>(); get.mockReturnValueOnce(pending.promise); const mounted = show(); mounted.unmount(); await act(async () => pending.resolve({ data: fixture.base })); expect(saved).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
it('does not apply a late preview after navigation', async () => {
  const fixture = await suppressionEditFixture(), pending = deferred<{ data: unknown }>(); get.mockResolvedValueOnce({ data: fixture.base }); post.mockReturnValueOnce(pending.promise); const mounted = show(); fireEvent.change(await screen.findByRole('textbox', { name: 'Title contains, literal and case-insensitive' }), { target: { value: fixture.proposal.title_contains } }); fireEvent.click(screen.getByRole('button', { name: 'Preview exact saved-rule edit' })); mounted.unmount(); await act(async () => pending.resolve({ data: fixture.preview })); expect(saved).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1);
});
it('does not report a late write response as success after navigation', async () => {
  const fixture = await start(), pending = deferred<{ data: unknown }>(); post.mockReturnValueOnce(pending.promise); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed rule edit' })); fixture.mounted.unmount(); await act(async () => pending.resolve({ data: fixture.result })); expect(saved).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(2);
});
it('shows exact per-group examples without mixing categories', async () => {
  await start(); expect(within(screen.getByRole('region', { name: 'Match both criteria sets' })).getByText('1')).toBeTruthy(); expect(screen.getByText('Alert #92: new Ä%_ only')).toBeTruthy(); expect(screen.getByText('Alert #91: old Ä%_ only')).toBeTruthy();
});
it('does not look up an invalid rule identity', async () => { show(0); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); });
