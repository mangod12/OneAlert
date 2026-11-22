import { evaluateNotificationPolicy, notificationPolicyFingerprint, type NotificationPolicyRequest, type SavedNotificationPreferences } from './notificationPolicyPreview';
export async function notificationPolicyFixture(overrides: Partial<SavedNotificationPreferences> = {}, selected: Partial<NotificationPolicyRequest> = {}) {
  const preferences: SavedNotificationPreferences = { email_notifications_enabled: true, notify_min_severity: 'high', muted_kinds: ['alert_created', 'case_assigned'], quiet_hours_start: '22:00', quiet_hours_end: '06:00', digest_enabled: true, digest_hour_utc: 7, ...overrides };
  const request: NotificationPolicyRequest = { scenario: 'new_alert', severity: 'high', utc_time: '23:00', ...selected };
  const base = { version: 1, preferences, preferences_fingerprint: await notificationPolicyFingerprint(preferences), retrieved_at: '2026-11-22T18:00:00Z' };
  const clock = request.utc_time ?? '18:00';
  const preview = { ...base, request, tested_utc_time: clock, time_basis: request.utc_time === null ? 'current_utc' : 'chosen_utc_clock', ...evaluateNotificationPolicy(preferences, request, clock), private_metadata: 'NEVER_RETAIN_RAW' };
  return { base, preview, request };
}
