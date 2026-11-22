import { useCallback, useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import apiClient from '../../api/client';
import { Panel } from '../ui/Panel';
import { OnCallRotationPanel } from './OnCallRotationPanel';
import { checkedAutomationPreferences, sameAutomationPreferences, automationPreferenceChanges, automationPreferenceKeys, automationPreferenceLabels, exactAutomationInteger, type AutomationPreferences } from '../../utils/automationPreferences';

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

  const [snapshot, setSnapshot] = useState<AutomationPreferences | null>(null);
  const [readAt, setReadAt] = useState(''), [notice, setNotice] = useState('');
  const [review, setReview] = useState<{ before: AutomationPreferences; next: AutomationPreferences } | null>(null);
  const reads = useRef(0), operation = useRef(false), ready = useRef(false), reviewRef = useRef<HTMLElement | null>(null);
  const invalidateRead = useCallback(() => { reads.current++; ready.current = false; }, []);
  const applyDraft = useCallback((prefs: AutomationPreferences) => {
    setEnabled(prefs.auto_escalate_incidents); setMinAlerts(String(prefs.auto_escalate_min_alerts));
    setMinSeverity(prefs.auto_escalate_min_severity); setSlaEnabled(prefs.sla_due_dates_enabled); setAutoAssign(prefs.auto_assign_new_alerts);
    setSlaDays({ sla_days_critical: String(prefs.sla_days_critical), sla_days_high: String(prefs.sla_days_high), sla_days_medium: String(prefs.sla_days_medium), sla_days_low: String(prefs.sla_days_low), sla_days_info: String(prefs.sla_days_info) });
  }, []);
  const load = useCallback(async () => {
    if (operation.current) return;
    const id = ++reads.current; ready.current = false; setLoading(true); setSnapshot(null); setLoadError(null); setReview(null); setNotice('');
    try {
      const resp = await apiClient.get('/auth/me/automation-preferences');
      if (id !== reads.current) return;
      const current = checkedAutomationPreferences(resp.data);
      ready.current = true; setSnapshot(current); applyDraft(current); setReadAt(new Date().toISOString());
    } catch { if (id === reads.current) setLoadError('Current automation preferences could not be verified. No defaults are offered for saving. Read them again before making a change.'); }
    finally { if (id === reads.current) setLoading(false); }
  }, [applyDraft]);

  useEffect(() => { void load(); return invalidateRead; }, [load, invalidateRead]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [review]);

  const draft = (): AutomationPreferences => checkedAutomationPreferences({
    auto_escalate_incidents: enabled, auto_escalate_min_alerts: exactAutomationInteger(minAlerts, 2, 20), auto_escalate_min_severity: minSeverity,
    sla_due_dates_enabled: slaEnabled, auto_assign_new_alerts: autoAssign,
    ...Object.fromEntries(SLA_FIELDS.map(({ key }) => [key, exactAutomationInteger(slaDays[key], 1, 90)])),
  });
  const save = () => {
    if (!ready.current || operation.current || loading || !snapshot || loadError) return;
    try {
      const next = draft(); setNotice('');
      if (sameAutomationPreferences(snapshot, next)) { setReview(null); setNotice('No preference changes to review. Nothing was sent.'); return; }
      setReview({ before: snapshot, next });
    } catch { setReview(null); setNotice('Use whole-number alert thresholds from 2 to 20 and SLA targets from 1 to 90 days. No save request was sent.'); }
  };
  const confirmSave = async () => {
    if (!ready.current || !review || !snapshot || loading || loadError || operation.current) return;
    try { if (!sameAutomationPreferences(draft(), review.next) || !sameAutomationPreferences(snapshot, review.before)) { setReview(null); setNotice('The draft or saved read changed. Review again before saving.'); return; } }
    catch { setReview(null); return; }
    operation.current = true; setSaving(true); setNotice(''); const id = reads.current; let sent = false;
    try {
      const { data } = await apiClient.get('/auth/me/automation-preferences');
      if (id !== reads.current) return;
      const current = checkedAutomationPreferences(data);
      if (!sameAutomationPreferences(current, review.before)) { setSnapshot(current); setReadAt(new Date().toISOString()); setReview(null); setNotice('Current preferences changed since your read. No save request was sent. Your draft is kept; review it again against the new saved values.'); return; }
      sent = true;
      const response = await apiClient.patch('/auth/me/automation-preferences', review.next);
      if (id !== reads.current) return;
      const confirmed = checkedAutomationPreferences(response.data);
      if (!sameAutomationPreferences(confirmed, review.next)) throw Error('Save response differed from the reviewed preferences.');
      setSnapshot(confirmed); applyDraft(confirmed); setReadAt(new Date().toISOString()); setReview(null);
      setNotice('The save response matches your reviewed preferences. Other sessions can still change them.');
    } catch {
      if (id !== reads.current) return;
      ready.current = false; setSnapshot(null); setReview(null);
      setLoadError(sent ? 'The save outcome could not be verified. It may already have applied. Read current preferences before any retry; no automatic retry was sent.' : 'Current preferences could not be checked. No save request was sent. Read current preferences again before reviewing a change.');
    } finally { operation.current = false; if (id === reads.current) setSaving(false); }
  };

  return (
    <>
    <Panel
      title="Incident auto-escalation"
      description="Automatically open an investigation when one asset collects enough active alerts at or above a severity. Nothing escalates while this is off."
      action={<Zap className="h-4 w-4 text-warning" />}
    >
      <div className="space-y-3 p-5">
        <p className="text-xs text-surface-400">Preferences are unknown until a complete current read succeeds. Saving first reviews your draft, then rechecks current preferences before sending the reviewed values. This is not an atomic lock; another session can still change preferences between the check and save. On-call rotation changes have their own separate review below.</p>
        <button type="button" disabled={loading || saving} onClick={() => void load()} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">{snapshot ? 'Discard draft and reread preferences' : 'Read current automation preferences'}</button>
        {loading && <p role="status" className="text-sm text-surface-300">Reading current automation preferences. No editable defaults are shown.</p>}
        {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
        {notice && <p role="status" className="text-sm text-surface-300">{notice}</p>}
        {snapshot && !loading && <p className="break-words text-xs text-surface-400">Current preference read or matching save response: {readAt}. Unchanged fields are still sent as part of the reviewed complete preference set.</p>}
      </div>
      {!loading && snapshot && <form className="space-y-4 p-5 pt-0" onChange={() => { setReview(null); setNotice(''); }} onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label className="flex items-center gap-3 text-sm text-surface-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={loading || saving}
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
              disabled={!enabled || loading || saving}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="automation-min-severity" className="mb-1.5 block text-xs font-medium text-surface-300">Highest severity at least</label>
            <select
              id="automation-min-severity"
              value={minSeverity}
              onChange={(event) => setMinSeverity(event.target.value)}
              disabled={!enabled || loading || saving}
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
              disabled={loading || saving}
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
                  disabled={!slaEnabled || loading || saving}
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
              disabled={loading || saving}
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
          {saving ? 'Checking and saving...' : 'Save automation'}
        </button>
        {review && <section ref={reviewRef} aria-label="Automation preference change review" className="min-w-0 space-y-3 rounded border border-warning/40 bg-surface-950 p-4">
          <h3 className="text-sm font-semibold text-surface-100">Review preference changes</h3>
          <p className="text-xs text-surface-400">Only the preferences below differ from your last complete read. Confirm sends the complete reviewed preference set after checking for changes in another session. It does not change the on-call rotation, reassign existing work or prove that a future automation ran.</p>
          <dl className="space-y-3 text-xs">{automationPreferenceChanges(review.before, review.next).map(change => <div key={change.key} className="min-w-0"><dt className="font-medium text-surface-200">{change.label}</dt><dd className="break-words text-surface-400">{typeof change.before === 'boolean' ? change.before ? 'On' : 'Off' : change.before} to {typeof change.after === 'boolean' ? change.after ? 'On' : 'Off' : change.after}</dd></div>)}</dl>
          <details className="text-xs text-surface-300">
            <summary className="cursor-pointer">Complete preference set sent on confirm</summary>
            <dl className="mt-3 space-y-2">{automationPreferenceKeys.map(key => <div key={key} className="flex flex-wrap justify-between gap-2"><dt>{automationPreferenceLabels[key]}</dt><dd className="font-medium text-surface-100">{typeof review.next[key] === 'boolean' ? review.next[key] ? 'On' : 'Off' : review.next[key]}</dd></div>)}</dl>
          </details>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => setReview(null)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Cancel preference review</button><button type="button" disabled={saving} onClick={() => void confirmSave()} className="rounded bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 disabled:opacity-40">{saving ? 'Checking and saving...' : 'Confirm reviewed preferences'}</button></div>
        </section>}
      </form>}

    </Panel>
    <OnCallRotationPanel />
    </>
  );
}
