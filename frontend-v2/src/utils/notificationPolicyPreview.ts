export const notificationPreferenceKeys = ['digest_enabled', 'digest_hour_utc', 'email_notifications_enabled', 'muted_kinds', 'notify_min_severity', 'quiet_hours_end', 'quiet_hours_start'] as const;
export const policyScenarios = {
  new_alert: 'New CVE/advisory alert email', alert_updated: 'Followed alert update', alert_mention: 'Alert note mention',
  case_mention: 'Case note mention', case_updated: 'Followed case update', case_assigned: 'Case assignment',
  incident_escalated: 'Automatic incident escalation', case_sla_breached: 'Case SLA breached', case_sla_due_soon: 'Case SLA due soon',
  case_task_due_soon: 'Case task due soon', case_task_overdue: 'Case task overdue',
} as const;
export type PolicyScenario = keyof typeof policyScenarios;
export const policySeverities = ['low', 'medium', 'high', 'critical'] as const;
export type PolicySeverity = typeof policySeverities[number] | null;
export interface SavedNotificationPreferences {
  digest_enabled: boolean; digest_hour_utc: number; email_notifications_enabled: boolean; muted_kinds: string[];
  notify_min_severity: string; quiet_hours_end: string | null; quiet_hours_start: string | null;
}
export interface NotificationPolicyBase { preferences: SavedNotificationPreferences; fingerprint: string; retrievedAt: string }
export interface NotificationPolicyRequest { scenario: PolicyScenario; severity: PolicySeverity; utc_time: string | null }
export const reasonLabels = { email_disabled: 'Email notifications are disabled.', kind_muted: 'This event kind is muted for the investigation dispatch predicate.', quiet_hours: 'Quiet hours filter noncritical events at the tested UTC clock time.', below_minimum: 'This known severity is below the effective minimum.' } as const;
export type PolicyReason = keyof typeof reasonLabels;
const ranks = { low: 0, medium: 1, high: 2, critical: 3 };
const fail = () => Error('The saved preference policy or its preview could not be verified. No results are available. Read the saved policy again.');
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
const text = (value: unknown, limit = 100): value is string => typeof value === 'string' && value.length <= limit && !/[\uD800-\uDFFF]/u.test(value);
const time = (value: unknown): value is string => text(value) && value.includes('T') && /(?:Z|\+00:00)$/.test(value) && !Number.isNaN(Date.parse(value));
export const policyClockValid = (value: unknown): value is string => typeof value === 'string' && value.length === 5 && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
export function checkedNotificationPreferences(value: unknown): SavedNotificationPreferences {
  const raw = object(value);
  if (Object.keys(raw).length !== notificationPreferenceKeys.length || notificationPreferenceKeys.some(key => !Object.hasOwn(raw, key)) || typeof raw.digest_enabled !== 'boolean' || typeof raw.email_notifications_enabled !== 'boolean' || !Number.isSafeInteger(raw.digest_hour_utc) || Number(raw.digest_hour_utc) < 0 || Number(raw.digest_hour_utc) > 23 || !text(raw.notify_min_severity) || !Array.isArray(raw.muted_kinds) || raw.muted_kinds.length > 100 || raw.muted_kinds.some(kind => !text(kind) || !kind.length)) throw fail();
  for (const key of ['quiet_hours_start', 'quiet_hours_end'] as const) if (raw[key] !== null && !policyClockValid(raw[key])) throw fail();
  return Object.fromEntries(notificationPreferenceKeys.map(key => [key, key === 'muted_kinds' ? [...raw.muted_kinds as string[]] : raw[key]])) as unknown as SavedNotificationPreferences;
}
export async function notificationPolicyFingerprint(preferences: SavedNotificationPreferences): Promise<string> {
  const checked = checkedNotificationPreferences(preferences);
  try {
    const wire = JSON.stringify(Object.fromEntries(notificationPreferenceKeys.map(key => [key, checked[key]])));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('onealert_notification_policy_v1\0' + wire));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  } catch { throw fail(); }
}
export async function checkedNotificationPolicyBase(value: unknown): Promise<NotificationPolicyBase> {
  const raw = object(value), preferences = checkedNotificationPreferences(raw.preferences);
  if (raw.version !== 1 || typeof raw.preferences_fingerprint !== 'string' || raw.preferences_fingerprint !== await notificationPolicyFingerprint(preferences) || !time(raw.retrieved_at)) throw fail();
  return { preferences, fingerprint: raw.preferences_fingerprint, retrievedAt: raw.retrieved_at };
}
export function checkedNotificationPolicyRequest(value: unknown): NotificationPolicyRequest {
  const raw = object(value);
  if (Object.keys(raw).length !== 3 || typeof raw.scenario !== 'string' || !Object.hasOwn(policyScenarios, raw.scenario) || raw.severity !== null && !policySeverities.includes(raw.severity as Exclude<PolicySeverity, null>) || raw.utc_time !== null && !policyClockValid(raw.utc_time)) throw fail();
  return { scenario: raw.scenario as PolicyScenario, severity: raw.severity as PolicySeverity, utc_time: raw.utc_time as string | null };
}
export function evaluateNotificationPolicy(preferences: SavedNotificationPreferences, request: NotificationPolicyRequest, clock: string) {
  const checked = checkedNotificationPreferences(preferences); checkedNotificationPolicyRequest(request); if (!policyClockValid(clock)) throw fail();
  const kindGate = request.scenario !== 'new_alert', kind = kindGate ? request.scenario : 'alert_created', muted = checked.muted_kinds.includes(kind);
  const minimumRaw = (checked.notify_min_severity || 'low').toLowerCase(), minimum = Object.hasOwn(ranks, minimumRaw) ? minimumRaw as keyof typeof ranks : 'medium';
  const start = checked.quiet_hours_start, end = checked.quiet_hours_end;
  const window = start === null && end === null ? 'unset' : start === null || end === null ? 'incomplete' : start === end ? 'zero_length' : 'configured';
  const quiet = start !== null && end !== null && start !== end && (start < end ? start <= clock && clock < end : clock >= start || clock < end);
  const decision = (level: PolicySeverity) => {
    const reasons: PolicyReason[] = [];
    if (!checked.email_notifications_enabled) reasons.push('email_disabled');
    if (kindGate && muted) reasons.push('kind_muted');
    if (quiet && level !== 'critical') reasons.push('quiet_hours');
    if (level !== null && ranks[level] < ranks[minimum]) reasons.push('below_minimum');
    return { severity: level, allowed_by_preference_predicate: reasons.length === 0, blocking_reasons: reasons };
  };
  return { kind, predicate: kindGate ? 'investigation_dispatch' : 'new_alert_email',
    gates: { email_enabled: checked.email_notifications_enabled, kind_is_muted: muted, kind_gate_applies: kindGate, quiet_window_state: window, inside_quiet_hours: quiet, critical_quiet_bypass: quiet && request.severity === 'critical', effective_minimum: minimum, minimum_fallback: !Object.hasOwn(ranks, minimumRaw), unknown_severity: request.severity === null, severity_meets_minimum: request.severity === null || ranks[request.severity] >= ranks[minimum] },
    selected: decision(request.severity), severity_matrix: [...policySeverities, null].map(decision), feed_kind_hidden_by_saved_mute: muted };
}
export interface NotificationPolicyPreview extends NotificationPolicyBase {
  request: NotificationPolicyRequest; testedUtcTime: string; timeBasis: 'current_utc' | 'chosen_utc_clock';
  evaluation: ReturnType<typeof evaluateNotificationPolicy>;
}
export async function checkedNotificationPolicyPreview(value: unknown, base: NotificationPolicyBase, requested: NotificationPolicyRequest): Promise<NotificationPolicyPreview> {
  const raw = object(value), current = await checkedNotificationPolicyBase(value), request = checkedNotificationPolicyRequest(raw.request);
  if (current.fingerprint !== base.fingerprint || request.scenario !== requested.scenario || request.severity !== requested.severity || request.utc_time !== requested.utc_time || !policyClockValid(raw.tested_utc_time)) throw fail();
  const basis = request.utc_time === null ? 'current_utc' : 'chosen_utc_clock';
  const expectedClock = request.utc_time ?? new Date(current.retrievedAt).toISOString().slice(11, 16);
  if (raw.time_basis !== basis || raw.tested_utc_time !== expectedClock) throw fail();
  const expected = evaluateNotificationPolicy(current.preferences, request, raw.tested_utc_time), gates = object(raw.gates);
  if (raw.kind !== expected.kind || raw.predicate !== expected.predicate || raw.feed_kind_hidden_by_saved_mute !== expected.feed_kind_hidden_by_saved_mute || Object.entries(expected.gates).some(([key, value]) => gates[key] !== value) || !Array.isArray(raw.severity_matrix) || raw.severity_matrix.length !== 5) throw fail();
  const checkDecision = (value: unknown, wanted: typeof expected.selected) => {
    const row = object(value);
    if (row.severity !== wanted.severity || row.allowed_by_preference_predicate !== wanted.allowed_by_preference_predicate || !Array.isArray(row.blocking_reasons) || JSON.stringify(row.blocking_reasons) !== JSON.stringify(wanted.blocking_reasons)) throw fail();
  };
  checkDecision(raw.selected, expected.selected); raw.severity_matrix.forEach((row, index) => checkDecision(row, expected.severity_matrix[index]));
  return { ...current, request, testedUtcTime: raw.tested_utc_time, timeBasis: basis, evaluation: expected };
}
