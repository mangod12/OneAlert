import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkedNotificationPolicyBase, checkedNotificationPolicyPreview, checkedNotificationPolicyRequest, evaluateNotificationPolicy, notificationPolicyFingerprint } from './notificationPolicyPreview';
import { notificationPolicyFixture } from './notificationPolicyPreview.fixture';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
it('verifies the real shared backend vector, Unicode snapshot hash, quiet-hours result and severity matrix', async () => {
  const raw = JSON.parse(readFileSync('../tests/fixtures/notification-policy-v1.json', 'utf8'));
  const base = await checkedNotificationPolicyBase(raw), checked = await checkedNotificationPolicyPreview(raw, base, raw.request);
  expect(checked.evaluation.selected.blocking_reasons).toEqual(['quiet_hours']); expect(checked.evaluation.gates.kind_gate_applies).toBe(false); expect(checked.evaluation.feed_kind_hidden_by_saved_mute).toBe(true);
  expect(checked.evaluation.severity_matrix[3].allowed_by_preference_predicate).toBe(true); expect(checked.evaluation.severity_matrix[4].blocking_reasons).toEqual(['quiet_hours']);
});
it.each(['21:59', '22:00', '05:59', '06:00'])('matches overnight boundaries and critical/unknown distinctions at %s UTC', async clock => {
  const fixture = await notificationPolicyFixture({}, { utc_time: clock }); const raw = fixture.base.preferences;
  const result = evaluateNotificationPolicy(raw, fixture.request, clock), inside = clock === '22:00' || clock === '05:59';
  expect(result.gates.inside_quiet_hours).toBe(inside); expect(result.severity_matrix[3].allowed_by_preference_predicate).toBe(true); expect(result.severity_matrix[4].blocking_reasons).toEqual(inside ? ['quiet_hours'] : []);
});
it('keeps the global toggle and investigation kind mute effective even for critical events', async () => {
  const fixture = await notificationPolicyFixture({ email_notifications_enabled: false }, { scenario: 'case_assigned', severity: 'critical' });
  const result = evaluateNotificationPolicy(fixture.base.preferences, fixture.request, '23:00'); expect(result.selected.blocking_reasons).toEqual(['email_disabled', 'kind_muted']); expect(result.gates.critical_quiet_bypass).toBe(true);
});
it.each(['equal', 'unset', 'incomplete', 'daytime'])('handles the %s quiet-window configuration exactly', async mode => {
  const fixture = await notificationPolicyFixture(mode === 'equal' ? { quiet_hours_start: '12:00', quiet_hours_end: '12:00' } : mode === 'unset' ? { quiet_hours_start: null, quiet_hours_end: null } : mode === 'incomplete' ? { quiet_hours_end: null } : { quiet_hours_start: '09:00', quiet_hours_end: '17:00' });
  const result = evaluateNotificationPolicy(fixture.base.preferences, fixture.request, '12:00'); expect(result.gates.inside_quiet_hours).toBe(mode === 'daytime'); expect(result.gates.quiet_window_state).toBe(mode === 'equal' ? 'zero_length' : mode === 'daytime' ? 'configured' : mode);
});
it.each(['legacy', 'constructor', '__proto__', ''])('uses the runtime minimum fallback/default for saved value %s', async minimum => {
  const fixture = await notificationPolicyFixture({ notify_min_severity: minimum }); const result = evaluateNotificationPolicy(fixture.base.preferences, fixture.request, '12:00'); expect(result.gates.effective_minimum).toBe(minimum === '' ? 'low' : 'medium'); expect(result.gates.minimum_fallback).toBe(minimum !== '');
});
it.each(['unknown field', 'missing field', 'bad hour', 'bad bool', 'bad quiet clock', 'bad mute', 'bad hash', 'bad time', 'bad version'])('refuses an unverifiable saved policy: %s', async mode => {
  const fixture = await notificationPolicyFixture(), raw = structuredClone(fixture.base) as unknown as Record<string, unknown>, prefs = raw.preferences as Record<string, unknown>;
  if (mode === 'unknown field') prefs.email = 'not allowed'; if (mode === 'missing field') delete prefs.digest_enabled; if (mode === 'bad hour') prefs.digest_hour_utc = 24; if (mode === 'bad bool') prefs.email_notifications_enabled = 1; if (mode === 'bad quiet clock') prefs.quiet_hours_start = '22:00\n'; if (mode === 'bad mute') prefs.muted_kinds = ['']; if (mode === 'bad hash') raw.preferences_fingerprint = '0'.repeat(64); if (mode === 'bad time') raw.retrieved_at = '2026-11-22T18:00:00+05:30'; if (mode === 'bad version') raw.version = 2;
  await expect(checkedNotificationPolicyBase(raw)).rejects.toThrow();
});
it.each(['snapshot', 'request', 'scope', 'kind', 'basis', 'clock', 'gate', 'allowed', 'reasons', 'matrix', 'feed'])('refuses contradictory preview evidence: %s', async mode => {
  const fixture = await notificationPolicyFixture(), base = await checkedNotificationPolicyBase(fixture.base), raw = structuredClone(fixture.preview);
  if (mode === 'snapshot') { raw.preferences = { ...raw.preferences, digest_hour_utc: 8 }; raw.preferences_fingerprint = await notificationPolicyFingerprint(raw.preferences); }
  if (mode === 'request') raw.request.scenario = 'case_assigned'; if (mode === 'scope') raw.predicate = 'investigation_dispatch'; if (mode === 'kind') raw.kind = 'case_assigned'; if (mode === 'basis') raw.time_basis = 'current_utc'; if (mode === 'clock') raw.tested_utc_time = '22:00'; if (mode === 'gate') raw.gates.kind_gate_applies = true; if (mode === 'allowed') raw.selected.allowed_by_preference_predicate = true; if (mode === 'reasons') raw.selected.blocking_reasons = []; if (mode === 'matrix') raw.severity_matrix.reverse(); if (mode === 'feed') raw.feed_kind_hidden_by_saved_mute = false;
  await expect(checkedNotificationPolicyPreview(raw, base, fixture.request)).rejects.toThrow();
});
it('checks a current-clock result against the exact UTC minute captured by the server, not the browser local time', async () => {
  const fixture = await notificationPolicyFixture({}, { utc_time: null }), base = await checkedNotificationPolicyBase(fixture.base);
  const checked = await checkedNotificationPolicyPreview(fixture.preview, base, fixture.request); expect(checked.testedUtcTime).toBe('18:00');
  fixture.preview.tested_utc_time = '23:30'; await expect(checkedNotificationPolicyPreview(fixture.preview, base, fixture.request)).rejects.toThrow();
});
it('projects only checked fields and never retains unrelated server metadata', async () => { const fixture = await notificationPolicyFixture(), base = await checkedNotificationPolicyBase(fixture.base); expect(JSON.stringify(await checkedNotificationPolicyPreview(fixture.preview, base, fixture.request))).not.toContain('NEVER_RETAIN'); });
it.each([{ scenario: ['new_alert'], severity: 'high', utc_time: null }, { scenario: 'alert_assigned', severity: 'high', utc_time: null }, { scenario: 'new_alert', severity: 'HIGH', utc_time: null }, { scenario: 'new_alert', severity: null, utc_time: '24:00' }])('strictly validates a hypothetical request %#', raw => { expect(() => checkedNotificationPolicyRequest(raw)).toThrow(); });
it('fails closed without secure independent hashing', async () => { const fixture = await notificationPolicyFixture(); vi.stubGlobal('crypto', {}); await expect(checkedNotificationPolicyBase(fixture.base)).rejects.toThrow(); });
