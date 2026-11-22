import { expect, it } from 'vitest';
import { automationPreferenceChanges, automationPreferenceKeys, checkedAutomationPreferences, exactAutomationInteger, sameAutomationPreferences } from './automationPreferences';
const prefs = { auto_escalate_incidents: true, auto_escalate_min_alerts: 4, auto_escalate_min_severity: 'high', sla_due_dates_enabled: true, auto_assign_new_alerts: false, sla_days_critical: 1, sla_days_high: 3, sla_days_medium: 7, sla_days_low: 14, sla_days_info: 30 };
it('projects only the complete supported preference set, not unknown response fields', () => {
  const raw = { ...prefs, secret: 'PRIVATE_FIELD', on_call_member_ids: [1] }; expect(checkedAutomationPreferences(raw)).toEqual(prefs); expect(raw.secret).toBe('PRIVATE_FIELD'); expect(automationPreferenceKeys).toHaveLength(10);
});
it.each([undefined, null, [], {}, { ...prefs, auto_assign_new_alerts: 'false' }, { ...prefs, auto_escalate_min_alerts: 3.5 }, { ...prefs, auto_escalate_min_alerts: '4' }, { ...prefs, auto_escalate_min_alerts: 1 }, { ...prefs, auto_escalate_min_alerts: 21 }, { ...prefs, sla_days_low: 0 }, { ...prefs, sla_days_info: 91 }, { ...prefs, auto_escalate_min_severity: 'unknown' }, { ...prefs, sla_due_dates_enabled: null }])('refuses incomplete or malformed recorded preferences without defaults %#', value => {
  expect(() => checkedAutomationPreferences(value)).toThrow();
});
it.each(['2.5', '2x', '2e0', '0x10', ' 3', '3 ', '-3', '+3', '', 'NaN', 'Infinity', '9007199254740993'])('does not partially parse the draft integer %s', value => {
  expect(() => exactAutomationInteger(value, 2, 20)).toThrow();
});
it('compares every field and labels each actual change without borrowing other scopes', () => {
  const next = { ...prefs, auto_assign_new_alerts: true, sla_days_high: 5 };
  expect(sameAutomationPreferences(prefs, { ...prefs })).toBe(true); expect(sameAutomationPreferences(prefs, next)).toBe(false);
  expect(automationPreferenceChanges(prefs, next)).toEqual([{ key: 'auto_assign_new_alerts', label: 'Auto-assign new work', before: false, after: true }, { key: 'sla_days_high', label: 'High SLA days', before: 3, after: 5 }]);
  expect(exactAutomationInteger('0003', 2, 20)).toBe(3);
});
