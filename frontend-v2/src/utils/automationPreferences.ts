export interface AutomationPreferences {
  auto_escalate_incidents: boolean;
  auto_escalate_min_alerts: number;
  auto_escalate_min_severity: string;
  sla_due_dates_enabled: boolean;
  auto_assign_new_alerts: boolean;
  sla_days_critical: number;
  sla_days_high: number;
  sla_days_medium: number;
  sla_days_low: number;
  sla_days_info: number;
}

export const automationPreferenceLabels: Record<keyof AutomationPreferences, string> = {
  auto_escalate_incidents: 'Open investigations automatically',
  auto_escalate_min_alerts: 'Active alerts on one asset',
  auto_escalate_min_severity: 'Minimum escalation severity',
  sla_due_dates_enabled: 'Set due dates on new work',
  auto_assign_new_alerts: 'Auto-assign new work',
  sla_days_critical: 'Critical SLA days',
  sla_days_high: 'High SLA days',
  sla_days_medium: 'Medium SLA days',
  sla_days_low: 'Low SLA days',
  sla_days_info: 'Info SLA days',
};
export const automationPreferenceKeys = Object.keys(automationPreferenceLabels) as (keyof AutomationPreferences)[];

export function checkedAutomationPreferences(value: unknown): AutomationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('The complete automation preference read could not be verified.');
  }
  const raw = value as Record<string, unknown>;
  for (const key of automationPreferenceKeys) {
    const field = raw[key];
    if (key === 'auto_escalate_min_severity') {
      if (!['low', 'medium', 'high', 'critical'].includes(field as string)) {
        throw Error('Unknown recorded escalation severity.');
      }
    } else if (key.startsWith('sla_days_') || key === 'auto_escalate_min_alerts') {
      const low = key === 'auto_escalate_min_alerts' ? 2 : 1;
      const high = key === 'auto_escalate_min_alerts' ? 20 : 90;
      if (!Number.isSafeInteger(field) || Number(field) < low || Number(field) > high) {
        throw Error('Invalid recorded automation threshold.');
      }
    } else if (typeof field !== 'boolean') {
      throw Error('Missing recorded automation toggle.');
    }
  }
  return Object.fromEntries(automationPreferenceKeys.map(key => [key, raw[key]])) as unknown as AutomationPreferences;
}

export const sameAutomationPreferences = (a: AutomationPreferences, b: AutomationPreferences) => (
  automationPreferenceKeys.every(key => a[key] === b[key])
);
export const automationPreferenceChanges = (a: AutomationPreferences, b: AutomationPreferences) => (
  automationPreferenceKeys.filter(key => a[key] !== b[key]).map(key => ({
    key, label: automationPreferenceLabels[key], before: a[key], after: b[key],
  }))
);

export function exactAutomationInteger(value: string, low: number, high: number) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < low || Number(value) > high) {
    throw Error('Use a whole-number automation threshold within its shown bounds.');
  }
  return Number(value);
}
