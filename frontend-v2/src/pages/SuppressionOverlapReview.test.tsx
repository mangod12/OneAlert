import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { makeSuppressionOverlap } from '../utils/suppressionOverlapReview.fixture';
import { suppressionRuleFingerprint } from '../utils/suppressionStatusReview';
import { SuppressionOverlapReview } from './SuppressionOverlapReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const show = (id = '7') => render(<MemoryRouter initialEntries={['/rules/' + id]}><Link to="/rules/17">Another selected rule</Link><Routes><Route path="/rules/:ruleId" element={<SuppressionOverlapReview />} /></Routes></MemoryRouter>);
function noWrites() { expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
it('compares paused saved criteria, shared versus exclusive current rows, exact rule details and private evidence links', async () => {
  get.mockResolvedValue({ data: await makeSuppressionOverlap() }); show(); await screen.findByText('Rule #7: Gateway 100%_ 名');
  expect(get).toHaveBeenCalledExactlyOnceWith('/suppression-rules/7/overlap-review'); expect(screen.getByText(/Paused when read; criteria-only comparison/)).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Selected criteria matches' })).getByText('2')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Shared with other enabled criteria' })).getByText('1')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Exclusive within this comparison' })).getByText('1')).toBeTruthy();
  expect(screen.getByText(/Per-rule counts can overlap/)).toBeTruthy(); expect(screen.getByText(/No rule or alert is changed/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open full current matches for other rule #8' }).getAttribute('href')).toBe('/app/settings/suppression-rules/8');
  expect(screen.getByRole('link', { name: 'Open exact current alert #90' }).getAttribute('href')).toBe('/app/alerts?alert=90'); noWrites();
});
it('downloads only the verified snapshot with its exact rule identity, current counts, bounded examples and limits', async () => {
  const raw = await makeSuppressionOverlap(); Object.assign(raw, { raw_data: 'PRIVATE_RAW_FIELD' }); get.mockResolvedValue({ data: raw });
  const created: Blob[] = []; const create = vi.fn((blob: Blob) => { created.push(blob); return 'blob:synthetic-overlap'; }), revoke = vi.fn(); vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const downloaded: string[] = []; const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded.push(this.download); }); show(); const download = await screen.findByRole('button', { name: 'Download verified overlap JSON' }); vi.useFakeTimers(); fireEvent.click(download);
  expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1); expect(downloaded).toEqual(['suppression-rule-7-current-overlap.json']);
  expect(created[0].type).toBe('application/json'); act(() => vi.runOnlyPendingTimers()); expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-overlap'); noWrites();
});
it.each(['bad', '0', '-1', '7.5', '9007199254740992'])('rejects invalid rule identity %s without fetching or offering an export', async id => {
  show(id); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Download verified overlap JSON' })).toBeNull(); noWrites();
});
it.each(['bad selected checksum', 'bad other checksum', 'wrong scope', 'wrong counts', 'unknown example rule'])('withholds all count cards and export when scope or evidence fails verification: %s', async mode => {
  const raw = await makeSuppressionOverlap(); if (mode === 'bad selected checksum') raw.rule_fingerprint = '0'.repeat(64); if (mode === 'bad other checksum') raw.overlapping_rules[0].rule_fingerprint = '0'.repeat(64); if (mode === 'wrong scope') (raw as unknown as Record<string, unknown>).scope = 'all'; if (mode === 'wrong counts') raw.shared_matching_alert_count = 3; if (mode === 'unknown example rule') raw.examples[0].other_rule_ids = [999];
  get.mockResolvedValue({ data: raw }); show(); await screen.findByRole('alert'); expect(screen.queryByRole('region', { name: 'Selected criteria matches' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Download verified overlap JSON' })).toBeNull(); noWrites();
});
it('clears old evidence and export immediately during an explicit reread, including when that read fails', async () => {
  const pending = deferred<{ data: unknown }>(); get.mockResolvedValueOnce({ data: await makeSuppressionOverlap() }).mockReturnValueOnce(pending.promise).mockRejectedValueOnce(Error('offline')); show(); await screen.findByRole('button', { name: 'Download verified overlap JSON' }); fireEvent.click(screen.getByRole('button', { name: 'Read current overlap' }));
  expect(screen.queryByRole('button', { name: 'Download verified overlap JSON' })).toBeNull(); expect(screen.queryByRole('region', { name: 'Selected criteria matches' })).toBeNull();
  await act(async () => pending.resolve({ data: await makeSuppressionOverlap() })); await screen.findByRole('button', { name: 'Download verified overlap JSON' }); fireEvent.click(screen.getByRole('button', { name: 'Read current overlap' })); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Download verified overlap JSON' })).toBeNull(); noWrites();
});
it('ignores a stale response after changing the exact selected rule route', async () => {
  const pending = deferred<{ data: unknown }>(), later = await makeSuppressionOverlap(); later.rule.id = 17; later.rule_fingerprint = await suppressionRuleFingerprint(later.rule);
  get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ data: later }); show(); fireEvent.click(screen.getByRole('link', { name: 'Another selected rule' })); await screen.findByText('Rule #17: Gateway 100%_ 名'); await act(async () => pending.resolve({ data: await makeSuppressionOverlap() }));
  expect(screen.queryByText('Rule #7: Gateway 100%_ 名')).toBeNull(); expect(screen.getByRole('link', { name: 'Open full current matches for selected rule #17' })).toBeTruthy(); noWrites();
});
it('shows the explicit server bound instead of inventing partial or zero counts', async () => {
  get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { detail: 'This review supports at most 200 other enabled rules. No partial overlap counts were returned.' } } }); show(); await screen.findByText(/No partial overlap counts were returned/); expect(screen.queryByRole('region', { name: 'Selected criteria matches' })).toBeNull(); noWrites();
});
it('shows true zero evidence with a future-safety caveat, not a green safety recommendation', async () => {
  const raw = await makeSuppressionOverlap(); raw.matching_alert_count = raw.shared_matching_alert_count = raw.exclusive_matching_alert_count = 0; raw.examples = []; raw.overlapping_rules = []; get.mockResolvedValue({ data: raw }); show(); await screen.findByText(/Zero matches do not make a rule safe/); expect(screen.getByText(/not proof of future exclusivity/)).toBeTruthy(); noWrites();
});
it('does not inject saved markup into the page', async () => {
  const raw = await makeSuppressionOverlap(); raw.rule.name = '<img src=x onerror=alert(1)>'; raw.rule_fingerprint = await suppressionRuleFingerprint(raw.rule); get.mockResolvedValue({ data: raw }); show(); await screen.findByText('Rule #7: <img src=x onerror=alert(1)>'); expect(document.querySelector('img')).toBeNull(); noWrites();
});
it('ignores late evidence after unmount without issuing any write', async () => {
  const pending = deferred<{ data: unknown }>(); get.mockReturnValue(pending.promise); const mounted = show(); mounted.unmount(); await act(async () => pending.resolve({ data: await makeSuppressionOverlap() })); expect(get).toHaveBeenCalledTimes(1); noWrites();
});
it('does not show or export unverified values without secure browser hashing', async () => {
  const raw = await makeSuppressionOverlap(); vi.stubGlobal('crypto', {}); get.mockResolvedValue({ data: raw }); show(); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Download verified overlap JSON' })).toBeNull(); await waitFor(() => expect(get).toHaveBeenCalledTimes(1)); noWrites();
});
