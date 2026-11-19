import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { Panel } from '../ui/Panel';
import { toast } from '../Toast';

interface AutomationPreferences {
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

const inputClass = 'w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 disabled:opacity-50';

const SLA_FIELDS = [
  { key: 'sla_days_critical', label: 'Critical' },
  { key: 'sla_days_high', label: 'High' },
  { key: 'sla_days_medium', label: 'Medium' },
  { key: 'sla_days_low', label: 'Low' },
  { key: 'sla_days_info', label: 'Info' },
] as const;

type SlaKey = (typeof SLA_FIELDS)[number]['key'];

export function AutomationPanel() {
  const [enabled, setEnabled] = useState(false);
  const [minAlerts, setMinAlerts] = useState('3');
  const [minSeverity, setMinSeverity] = useState('high');
  const [slaEnabled, setSlaEnabled] = useState(false);
  const [autoAssign, setAutoAssign] = useState(false);
  const [slaDays, setSlaDays] = useState<Record<SlaKey, string>>({
    sla_days_critical: '1',
    sla_days_high: '3',
    sla_days_medium: '7',
    sla_days_low: '14',
    sla_days_info: '30',
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const resp = await apiClient.get<AutomationPreferences>('/auth/me/automation-preferences');
      setEnabled(resp.data.auto_escalate_incidents);
      setMinAlerts(String(resp.data.auto_escalate_min_alerts));
      setMinSeverity(resp.data.auto_escalate_min_severity);
      setSlaEnabled(resp.data.sla_due_dates_enabled);
      setAutoAssign(resp.data.auto_assign_new_alerts);
      setSlaDays({
        sla_days_critical: String(resp.data.sla_days_critical),
        sla_days_high: String(resp.data.sla_days_high),
        sla_days_medium: String(resp.data.sla_days_medium),
        sla_days_low: String(resp.data.sla_days_low),
        sla_days_info: String(resp.data.sla_days_info),
      });
      setLoadError(null);
    } catch {
      setLoadError('Automation preferences could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const alerts = parseInt(minAlerts, 10);
    if (!Number.isFinite(alerts) || alerts < 2 || alerts > 20) {
      toast('Alert threshold must be between 2 and 20.', 'error');
      return;
    }
    const parsedSla = {} as Record<SlaKey, number>;
    for (const { key } of SLA_FIELDS) {
      const days = parseInt(slaDays[key], 10);
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        toast('SLA targets must be between 1 and 90 days.', 'error');
        return;
      }
      parsedSla[key] = days;
    }
    setSaving(true);
    try {
      await apiClient.patch('/auth/me/automation-preferences', {
        auto_escalate_incidents: enabled,
        auto_escalate_min_alerts: alerts,
        auto_escalate_min_severity: minSeverity,
        sla_due_dates_enabled: slaEnabled,
        auto_assign_new_alerts: autoAssign,
        ...parsedSla,
      });
      toast('Automation preferences saved.', 'success');
    } catch (error) {
      toast(getApiErrorMessage(error, 'Preferences could not be saved.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Incident auto-escalation"
      description="Automatically open an investigation when one asset collects enough active alerts at or above a severity. Nothing escalates while this is off."
      action={<Zap className="h-4 w-4 text-warning" />}
    >
      <form className="space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
        <label className="flex items-center gap-3 text-sm text-surface-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={loading}
            className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
          />
          Auto-escalate noisy incidents to an investigation
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="automation-min-alerts" className="mb-1.5 block text-xs font-medium text-surface-300">Active alerts on one asset</label>
            <input
              id="automation-min-alerts"
              type="number"
              min={2}
              max={20}
              value={minAlerts}
              onChange={(event) => setMinAlerts(event.target.value)}
              disabled={!enabled || loading}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="automation-min-severity" className="mb-1.5 block text-xs font-medium text-surface-300">Highest severity at least</label>
            <select
              id="automation-min-severity"
              value={minSeverity}
              onChange={(event) => setMinSeverity(event.target.value)}
              disabled={!enabled || loading}
              className={inputClass}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-surface-500">
          When both thresholds are met, an investigation opens and links the active alerts. An asset with an open investigation is not escalated again.
        </p>

        <div className="border-t border-surface-700 pt-4">
          <label className="flex items-center gap-3 text-sm text-surface-200">
            <input
              type="checkbox"
              checked={slaEnabled}
              onChange={(event) => setSlaEnabled(event.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            Set SLA due dates on new alerts and investigations
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SLA_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`sla-${key}`} className="mb-1.5 block text-xs font-medium text-surface-300">{label} (days)</label>
                <input
                  id={`sla-${key}`}
                  type="number"
                  min={1}
                  max={90}
                  value={slaDays[key]}
                  onChange={(event) => setSlaDays((prev) => ({ ...prev, [key]: event.target.value }))}
                  disabled={!slaEnabled || loading}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-surface-500">
            Every new alert and investigation, opened manually or by automation, gets a target close date this many days out, based on its severity.
          </p>
        </div>

        <div className="border-t border-surface-700 pt-4">
          <label className="flex items-center gap-3 text-sm text-surface-200">
            <input
              type="checkbox"
              checked={autoAssign}
              onChange={(event) => setAutoAssign(event.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            Auto-assign new alerts and investigations across your organization
          </label>
          <p className="mt-3 text-xs text-surface-500">
            Each new alert and auto-escalated investigation goes to the active org member with the fewest open assigned items, and they get a notification. Applies only when your organization has at least two active members.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving || loading}
          className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save automation'}
        </button>
      </form>
    </Panel>
  );
}
