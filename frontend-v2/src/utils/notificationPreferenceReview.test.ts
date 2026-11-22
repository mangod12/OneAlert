import { describe, expect, it } from 'vitest';
import { checkedEditableNotificationPreferences, notificationDigestHour, notificationDraftClock, notificationKindLabels, notificationPreferenceChanges, notificationPreferenceText, sameNotificationPreferences } from './notificationPreferenceReview';
const prefs = { email_notifications_enabled: true, notify_min_severity: 'high', muted_kinds: ['alert_created', 'case_task_overdue'], quiet_hours_start: '22:00', quiet_hours_end: '06:00', digest_enabled: true, digest_hour_utc: 7 };
it('verifies all seven editable fields, projects a detached mute list and accepts every offered real event kind', () => {
  const checked = checkedEditableNotificationPreferences(prefs); checked.muted_kinds.push('case_updated'); expect(prefs.muted_kinds).toHaveLength(2);
  expect(checkedEditableNotificationPreferences({ ...prefs, muted_kinds: Object.keys(notificationKindLabels) }).muted_kinds).toHaveLength(17);
});
it.each([{ notify_min_severity: 'legacy' }, { quiet_hours_start: null }, { quiet_hours_start: '22:00\n' }, { muted_kinds: ['not_supported'] }, { muted_kinds: ['alert_created', 'alert_created'] }, { digest_hour_utc: 24 }, { digest_hour_utc: '7' }, { email_notifications_enabled: 1 }, { digest_enabled: null }, { email: 'private' }])('refuses unsupported or incomplete editable snapshots: %j', change => expect(() => checkedEditableNotificationPreferences({ ...prefs, ...change })).toThrow());
it('accepts null quiet pairs and zero-length windows without changing their meaning', () => { expect(checkedEditableNotificationPreferences({ ...prefs, quiet_hours_start: null, quiet_hours_end: null }).quiet_hours_start).toBeNull(); expect(checkedEditableNotificationPreferences({ ...prefs, quiet_hours_end: '22:00' }).quiet_hours_end).toBe('22:00'); });
it('compares mute lists as sets without mutating their saved order, but detects every other field', () => {
  const reordered = { ...prefs, muted_kinds: [...prefs.muted_kinds].reverse() }; expect(sameNotificationPreferences(prefs, reordered)).toBe(true); expect(notificationPreferenceChanges(prefs, reordered)).toEqual([]); expect(prefs.muted_kinds).toEqual(['alert_created', 'case_task_overdue']);
  const next = { ...prefs, email_notifications_enabled: false, notify_min_severity: 'critical', muted_kinds: ['case_mention'], quiet_hours_start: null, quiet_hours_end: null, digest_enabled: false, digest_hour_utc: 8 };
  expect(sameNotificationPreferences(prefs, next)).toBe(false); expect(notificationPreferenceChanges(prefs, next)).toHaveLength(7);
});
describe('strict draft values', () => {
  it.each(['', '7.0', '07', '1e1', '-1', '24', ' 7', '7tail'])('refuses invalid digest hour %j', value => expect(() => notificationDigestHour(value)).toThrow());
  it.each(['0', '7', '23'])('accepts exact UTC hour %s', value => expect(notificationDigestHour(value)).toBe(Number(value)));
  it.each(['9:00', '24:00', '22:00:00', '22:00\n'])('refuses invalid quiet clock %j', value => expect(() => notificationDraftClock(value)).toThrow());
  it('supports clearing clocks and labels complete proposals', () => { expect(notificationDraftClock('')).toBeNull(); expect(notificationDraftClock('00:00')).toBe('00:00'); expect(notificationPreferenceText(null)).toBe('Not set'); expect(notificationPreferenceText(false)).toBe('Off'); expect(notificationPreferenceText([])).toBe('None'); expect(notificationPreferenceText(['case_task_overdue'])).toBe('Task overdue'); });
});
