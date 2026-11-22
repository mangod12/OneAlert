import { checkedNotificationPreferences, notificationPreferenceKeys, policyClockValid, type SavedNotificationPreferences } from './notificationPolicyPreview';

export const notificationKindLabels = {
  alert_created: 'New alerts', case_assigned: 'Case assignments', case_task_assigned: 'Task assignments', case_task_due_soon: 'Task due soon', case_task_overdue: 'Task overdue',
  case_updated: 'Case updates', case_watching: 'Case watch additions', case_mention: 'Case mentions', alert_mention: 'Alert mentions', alert_assigned: 'Alert assignments',
  alert_updated: 'Alert updates', alert_watching: 'Alert watch additions', incident_escalated: 'Incident escalations', case_sla_breached: 'SLA breaches', case_sla_due_soon: 'SLA due soon',
  alert_sla_breached: 'Alert SLA breaches', alert_sla_due_soon: 'Alert SLA due soon',
} as const;
export const notificationPreferenceLabels: Record<keyof SavedNotificationPreferences, string> = {
  email_notifications_enabled: 'Global email toggle', notify_min_severity: 'Minimum severity', muted_kinds: 'Muted notification kinds', quiet_hours_start: 'Quiet hours start (UTC)', quiet_hours_end: 'Quiet hours end (UTC)', digest_enabled: 'Daily digest', digest_hour_utc: 'Digest hour (UTC)',
};
export function checkedEditableNotificationPreferences(value: unknown): SavedNotificationPreferences {
  const checked = checkedNotificationPreferences(value);
  if (!['low', 'medium', 'high', 'critical'].includes(checked.notify_min_severity) || checked.muted_kinds.some(kind => !Object.hasOwn(notificationKindLabels, kind)) || new Set(checked.muted_kinds).size !== checked.muted_kinds.length || (checked.quiet_hours_start === null) !== (checked.quiet_hours_end === null)) throw Error('The saved notification preferences cannot be edited safely by this form.');
  return checked;
}
const sameMutedKinds = (a: string[], b: string[]) => { const left = [...a].sort(), right = [...b].sort(); return left.length === right.length && left.every((kind, index) => kind === right[index]); };
export const sameNotificationPreferences = (a: SavedNotificationPreferences, b: SavedNotificationPreferences) => notificationPreferenceKeys.every(key => key === 'muted_kinds' ? sameMutedKinds(a.muted_kinds, b.muted_kinds) : a[key] === b[key]);
export function notificationPreferenceChanges(before: SavedNotificationPreferences, after: SavedNotificationPreferences) {
  return notificationPreferenceKeys.filter(key => key === 'muted_kinds' ? !sameMutedKinds(before.muted_kinds, after.muted_kinds) : before[key] !== after[key]).map(key => ({ key, label: notificationPreferenceLabels[key], before: before[key], after: after[key] }));
}
export function notificationPreferenceText(value: SavedNotificationPreferences[keyof SavedNotificationPreferences]): string {
  if (value === null) return 'Not set';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return value.length ? value.map(kind => notificationKindLabels[kind as keyof typeof notificationKindLabels]).join(', ') : 'None';
  return String(value);
}
export function notificationDraftClock(value: string) { if (value === '') return null; if (!policyClockValid(value)) throw Error('Use a complete UTC clock time.'); return value; }
export function notificationDigestHour(value: string) { if (!/^(?:[0-9]|1[0-9]|2[0-3])$/.test(value)) throw Error('Use a whole UTC hour from 0 to 23.'); return Number(value); }
