import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { suppressionRuleFingerprint, type SuppressionRuleSnapshot } from '../../utils/suppressionStatusReview';
import { SuppressionStatusReview } from './SuppressionStatusReview';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), saved = vi.fn(), close = vi.fn();
const base: SuppressionRuleSnapshot = { id: 7, name: 'Plant gateway 名 <script>', cve_id: null, asset_id: 11, severity: 'high', title_contains: '100%_', duration_hours: 24, enabled: true, created_at: '2026-01-01T00:00:00Z' };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function review(rule = base) { return { rule, rule_fingerprint: await suppressionRuleFingerprint(rule), page: 1, size: 10, scope: 'active', search: '', total: 1, matching_total: 1, criteria_present: [rule.cve_id, rule.asset_id, rule.severity, rule.title_contains].some(value => value !== null && value !== ''), retrieved_at: '2026-01-01T00:00:00Z', alerts: [{ id: 90, asset_id: 11, title: 'Gateway 100%_ current example', cve_id: null, severity: 'high', status: 'acknowledged', created_at: '2026-01-01T00:00:00Z' }] }; }
async function result(raw: Awaited<ReturnType<typeof review>>, enabled = false) { const rule = { ...raw.rule, enabled }; return { conditional_update_applied: true, reviewed_fingerprint: raw.rule_fingerprint, rule, rule_fingerprint: await suppressionRuleFingerprint(rule) }; }
function show(enabled = false) { return render(<SuppressionStatusReview ruleId={7} enabled={enabled} onClose={close} onSaved={saved} />); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
it.each([true, false])('reviews and confirms only the captured target enabled=%s, with exact current evidence and unchanged criteria', async enabled => {
  const raw = await review({ ...base, enabled: !enabled }); get.mockResolvedValue({ data: raw }); post.mockResolvedValue({ data: await result(raw, enabled) }); show(enabled);
  const confirm = await screen.findByRole('button', { name: enabled ? 'Confirm reviewed enable' : 'Confirm reviewed pause' });
  expect(get).toHaveBeenCalledExactlyOnceWith('/suppression-rules/7/matching-alerts', { params: { page: 1, size: 10, scope: 'active', search: '' } }); expect(post).not.toHaveBeenCalled();
  expect(screen.getByText('Rule #7: Plant gateway 名 <script>')).toBeTruthy(); expect(document.querySelector('script')).toBeNull();
  expect(screen.getByRole('link', { name: 'Open exact current alert #90' }).getAttribute('href')).toBe('/app/alerts?alert=90');
  fireEvent.click(confirm); fireEvent.click(confirm);
  await screen.findByText(/conditional status change was confirmed/);
  expect(post).toHaveBeenCalledExactlyOnceWith('/suppression-rules/7/reviewed-status', { expected_fingerprint: raw.rule_fingerprint, enabled }); expect(saved).toHaveBeenCalledExactlyOnceWith({ ...raw.rule, enabled });
  expect(screen.queryByRole('button', { name: /Confirm reviewed (pause|enable)/ })).toBeNull();
});
it('keeps the busy review open, blocks repeated submission and requires a verified response before success', async () => {
  const raw = await review(), pending = deferred<{ data: unknown }>(); get.mockResolvedValue({ data: raw }); post.mockReturnValue(pending.promise); show();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm reviewed pause' }));
  expect((screen.getByRole('button', { name: 'Close status review' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Close status review' })); expect(close).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1); await act(async () => pending.resolve({ data: await result(raw) })); await screen.findByText(/conditional status change was confirmed/);
  fireEvent.click(screen.getByRole('button', { name: 'Close status review' })); expect(close).toHaveBeenCalledTimes(1);
});
it('does not reverse a stale list target when the freshly read rule already has the clicked status', async () => {
  get.mockResolvedValue({ data: await review({ ...base, enabled: false }) }); show(); await screen.findByText(/already has the requested status/);
  expect(screen.queryByRole('button', { name: 'Confirm reviewed pause' })).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('blocks enabling an empty-criteria legacy rule but allows an explicitly reviewed pause', async () => {
  const empty = { ...base, cve_id: null, asset_id: null, severity: null, title_contains: null, enabled: false };
  get.mockResolvedValueOnce({ data: await review(empty) }); const mounted = show(true); const confirm = await screen.findByRole('button', { name: 'Confirm reviewed enable' }); expect((confirm as HTMLButtonElement).disabled).toBe(true); fireEvent.click(confirm); expect(post).not.toHaveBeenCalled(); mounted.unmount();
  get.mockResolvedValueOnce({ data: await review({ ...empty, enabled: true }) }); show(); expect((await screen.findByRole('button', { name: 'Confirm reviewed pause' }) as HTMLButtonElement).disabled).toBe(false);
});
it.each(['bad fingerprint', 'different query', 'missing criteria', 'wrong rule', 'bad row'])('never offers a mutation for unverifiable evidence: %s', async mode => {
  const raw = await review();
  if (mode === 'bad fingerprint') raw.rule_fingerprint = '0'.repeat(64);
  if (mode === 'different query') raw.scope = 'all';
  if (mode === 'missing criteria') raw.criteria_present = false;
  if (mode === 'wrong rule') raw.rule = { ...base, id: 8 };
  if (mode === 'bad row') raw.alerts[0].status = 'resolved';
  get.mockResolvedValue({ data: raw }); show(); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Confirm reviewed pause' })).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('requires an explicit reread after a server-side stale rejection and preserves the original clicked target', async () => {
  const raw = await review(); get.mockResolvedValueOnce({ data: raw }).mockResolvedValueOnce({ data: await review({ ...base, enabled: false }) }); post.mockRejectedValueOnce({ response: { status: 409 } }); show();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm reviewed pause' })); await screen.findByText(/server made no status change for this request/); expect(get).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Read current rule evidence' })); await screen.findByText(/already has the requested status/); expect(post).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: /Confirm reviewed/ })).toBeNull();
});
it.each(['offline', 'missing conditional result', 'unexpected saved values', 'bad response hash'])('treats unverified writes as unknown, never success or an automatic retry: %s', async mode => {
  const raw = await review(); get.mockResolvedValue({ data: raw }); const response = await result(raw);
  if (mode === 'offline') post.mockRejectedValueOnce(Error('Offline'));
  else { if (mode === 'missing conditional result') response.conditional_update_applied = false; if (mode === 'unexpected saved values') { response.rule = { ...response.rule, title_contains: 'other rule value' }; response.rule_fingerprint = await suppressionRuleFingerprint(response.rule); } if (mode === 'bad response hash') response.rule_fingerprint = '0'.repeat(64); post.mockResolvedValueOnce({ data: response }); }
  show(); fireEvent.click(await screen.findByRole('button', { name: 'Confirm reviewed pause' })); await screen.findByText(/may already have applied/); expect(saved).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: 'Confirm reviewed pause' })).toBeNull();
});
it('ignores a late evidence read after the dialog has been dismissed', async () => {
  const raw = await review(), pending = deferred<{ data: unknown }>(); get.mockReturnValue(pending.promise); const mounted = show(); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1); mounted.unmount(); await act(async () => pending.resolve({ data: raw })); expect(saved).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
it('ignores a late write response after navigation without retrying or reporting unverified success', async () => {
  const raw = await review(), pending = deferred<{ data: unknown }>(); get.mockResolvedValue({ data: raw }); post.mockReturnValue(pending.promise); const mounted = show(); fireEvent.click(await screen.findByRole('button', { name: 'Confirm reviewed pause' })); mounted.unmount(); await act(async () => pending.resolve({ data: await result(raw) })); expect(saved).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1);
});
it('fails closed when the browser cannot independently hash the saved rule', async () => {
  const raw = await review(); vi.stubGlobal('crypto', {}); get.mockResolvedValue({ data: raw }); show(); await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Confirm reviewed pause' })).toBeNull(); await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
});
