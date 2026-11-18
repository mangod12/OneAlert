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
}

const inputClass = 'w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 disabled:opacity-50';

export function AutomationPanel() {
  const [enabled, setEnabled] = useState(false);
  const [minAlerts, setMinAlerts] = useState('3');
  const [minSeverity, setMinSeverity] = useState('high');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const resp = await apiClient.get<AutomationPreferences>('/auth/me/automation-preferences');
      setEnabled(resp.data.auto_escalate_incidents);
      setMinAlerts(String(resp.data.auto_escalate_min_alerts));
      setMinSeverity(resp.data.auto_escalate_min_severity);
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
    setSaving(true);
    try {
      await apiClient.patch('/auth/me/automation-preferences', {
        auto_escalate_incidents: enabled,
        auto_escalate_min_alerts: alerts,
        auto_escalate_min_severity: minSeverity,
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
