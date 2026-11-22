import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { checkedNotificationPolicyBase, checkedNotificationPolicyPreview, policyScenarios, policySeverities, reasonLabels, type NotificationPolicyBase, type NotificationPolicyPreview as PolicyPreview, type NotificationPolicyRequest, type PolicyScenario } from '../../utils/notificationPolicyPreview';
import { Panel } from '../ui/Panel';
import { useDialogFocus } from '../ui/useDialogFocus';

const buttonClass = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
const inputClass = 'mt-1 w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100';
const severityName = (severity: string | null) => severity === null ? 'Unknown / unclassified' : severity;

function SavedPolicyDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null), generation = useRef(0), operation = useRef(false);
  useDialogFocus(dialog, onClose);
  const [base, setBase] = useState<NotificationPolicyBase | null>(null), [result, setResult] = useState<PolicyPreview | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [scenario, setScenario] = useState<PolicyScenario>('new_alert'), [severity, setSeverity] = useState('high'), [clock, setClock] = useState('');
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++generation.current; setLoading(true); setBase(null); setResult(null); setError('');
    try {
      const { data } = await apiClient.get('/notifications/policy-review');
      const checked = await checkedNotificationPolicyBase(data);
      if (request === generation.current) setBase(checked);
    } catch { if (request === generation.current) setError('The saved notification policy could not be verified. No preview results are retained. Read it again, or review the saved values in Settings. Secure hashing support is required.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const preview = async () => {
    if (!base || operation.current || loading) return;
    const selected: NotificationPolicyRequest = { scenario, severity: severity === 'unknown' ? null : severity as NotificationPolicyRequest['severity'], utc_time: clock || null };
    const request = ++generation.current; operation.current = true; setBusy(true); setResult(null); setError('');
    try {
      const { data } = await apiClient.post('/notifications/policy-preview', { expected_fingerprint: base.fingerprint, ...selected });
      const checked = await checkedNotificationPolicyPreview(data, base, selected);
      if (request === generation.current) setResult(checked);
    } catch (failure: unknown) {
      if (request !== generation.current) return;
      setBase(null);
      const status = (failure as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? 'Saved notification preferences changed. Read the saved policy again before testing it. No results from the old snapshot are retained.' : 'The policy preview could not be verified. No results are retained. Read the saved policy again. This inspector sends no notifications and changes no preferences.');
    } finally { operation.current = false; if (request === generation.current) setBusy(false); }
  };
  const updateInput = (change: () => void) => { setResult(null); setError(''); change(); };
  const evaluation = result?.evaluation;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Inspect saved notification policy" className="max-h-[90dvh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 text-surface-300 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Saved notification policy</h2><button type="button" onClick={onClose} className={buttonClass}>Close policy inspector</button></div>
    <p className="text-sm text-surface-400">A read-only check of saved preferences, not unsaved Settings edits. This creates no event, sends no notification and changes no preference. It is not a delivery receipt, historical explanation, replay or schedule.</p>
    {loading && <p role="status">Reading the current saved preference snapshot...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {base && <>
      <section aria-label="Verified saved notification preferences" className="space-y-2 rounded border border-surface-700 p-3 text-xs">
        <h3 className="font-semibold text-surface-100">Saved preference snapshot</h3>
        <p>Email toggle: {base.preferences.email_notifications_enabled ? 'on' : 'off'} · Minimum severity as saved: {JSON.stringify(base.preferences.notify_min_severity)}</p>
        <p>Quiet hours, UTC: {base.preferences.quiet_hours_start ?? 'not set'} to {base.preferences.quiet_hours_end ?? 'not set'}. Start is inclusive; end is exclusive. Equal endpoints mute nothing, not a full day.</p>
        <p>Muted kinds as saved: {base.preferences.muted_kinds.length ? base.preferences.muted_kinds.join(', ') : 'none'}.</p>
        <p>Daily digest: {base.preferences.digest_enabled ? 'enabled' : 'disabled'}, configured hour {String(base.preferences.digest_hour_utc).padStart(2, '0')}:00 UTC. Digest eligibility and queue contents are separate and are not simulated here.</p>
        <p className="text-surface-400">Read at {base.retrievedAt}. A changed saved snapshot requires a new read. This is not a lock or revision history. No email address or webhook destination is included.</p>
      </section>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void preview(); }}>
        <fieldset disabled={busy || loading} className="grid min-w-0 gap-3 sm:grid-cols-3">
          <label className="min-w-0 text-xs">Event path<select aria-label="Event path" value={scenario} onChange={event => updateInput(() => setScenario(event.target.value as PolicyScenario))} className={inputClass}>{Object.entries(policyScenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="min-w-0 text-xs">Event severity<select aria-label="Event severity" value={severity} onChange={event => updateInput(() => setSeverity(event.target.value))} className={inputClass}>{policySeverities.map(value => <option key={value} value={value}>{value}</option>)}<option value="unknown">Unknown / unclassified</option></select></label>
          <label className="min-w-0 text-xs">UTC clock time<input aria-label="UTC clock time" type="time" step={60} value={clock} onChange={event => updateInput(() => setClock(event.target.value))} className={inputClass} /></label>
        </fieldset>
        <p className="text-xs text-surface-400">Leave the clock empty to test the server's current UTC minute. A chosen value is only a hypothetical UTC time of day, not a future delivery promise or your local timezone.</p>
        <button type="submit" disabled={busy || loading} className={buttonClass}>{busy ? 'Checking saved preference predicate...' : 'Test saved policy, send nothing'}</button>
      </form>
    </>}
    {result && evaluation && <>
      <section aria-label="Verified preference predicate outcome" className="space-y-3 rounded border border-surface-700 p-3">
        <h3 className={`font-semibold ${evaluation.selected.allowed_by_preference_predicate ? 'text-success' : 'text-warning'}`}>{evaluation.selected.allowed_by_preference_predicate ? 'Allowed by the saved preference predicate' : 'Filtered by the saved preference predicate'}</h3>
        <p className="text-sm">{policyScenarios[result.request.scenario]} · {severityName(result.request.severity)} · {result.testedUtcTime} UTC ({result.timeBasis === 'current_utc' ? 'server current clock' : 'chosen hypothetical clock'}).</p>
        <ul className="list-inside list-disc space-y-1 text-xs">{evaluation.selected.blocking_reasons.map(reason => <li key={reason}>{reasonLabels[reason]}</li>)}</ul>
        {evaluation.selected.allowed_by_preference_predicate && <p className="text-xs">Passing this preference check does not prove an event will occur or a message will be sent or received.</p>}
        <dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries({ 'Email gate': evaluation.gates.email_enabled ? 'on' : 'off', 'Selected kind': evaluation.kind, 'Selected kind muted': evaluation.gates.kind_is_muted ? 'yes' : 'no', 'Kind gate used by this predicate': evaluation.gates.kind_gate_applies ? 'yes' : 'no', 'Quiet window state': evaluation.gates.quiet_window_state, 'Inside quiet hours at tested UTC clock': evaluation.gates.inside_quiet_hours ? 'yes' : 'no', 'Critical quiet-hours bypass': evaluation.gates.critical_quiet_bypass ? 'yes, quiet hours only' : 'not used', 'Effective minimum': evaluation.gates.effective_minimum, 'Known severity meets minimum': evaluation.gates.unknown_severity ? 'unknown severity is not filtered by the minimum gate' : evaluation.gates.severity_meets_minimum ? 'yes' : 'no', 'Feed filter for this kind': evaluation.feed_kind_hidden_by_saved_mute ? 'current feed excludes this muted kind' : 'not hidden by a saved kind mute' }).map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd>{value}</dd></div>)}</dl>
        {evaluation.gates.minimum_fallback && <p className="text-xs text-warning">The saved minimum is unrecognized. The runtime uses its medium fallback; the preview uses that same fallback.</p>}
        <p className="text-xs text-surface-400">Critical bypasses quiet hours only, never the global email toggle or an applicable muted-kind gate. Unknown severity passes the minimum gate but is still noncritical for quiet hours.</p>
      </section>
      <section aria-label="Verified severity comparison" className="space-y-3"><h3 className="font-semibold text-surface-100">Same event path and UTC clock, all severity classes</h3><ul className="grid gap-3 sm:grid-cols-5">{evaluation.severity_matrix.map(row => <li key={row.severity ?? 'unknown'} aria-current={row.severity === result.request.severity ? 'true' : undefined} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs"><h4 className="font-semibold text-surface-100">{severityName(row.severity)}</h4><p className={row.allowed_by_preference_predicate ? 'text-success' : 'text-warning'}>{row.allowed_by_preference_predicate ? 'Preference check passes' : 'Preference check filters'}</p><ul className="space-y-1">{row.blocking_reasons.map(reason => <li key={reason}>{reasonLabels[reason]}</li>)}</ul></li>)}</ul></section>
      <section aria-label="Policy preview limits" className="space-y-2 text-xs text-surface-400">
        {evaluation.predicate === 'new_alert_email' ? <p>This is the immediate-email check used by new CVE/advisory alert paths, not every alert source. Muted kinds affect the feed but are not consulted by this email predicate. Alert webhooks are dispatched separately and are not simulated.</p> : <p>This is the shared preference check used when this investigation event reaches its email/Slack/generic-webhook dispatch path. Recipient selection and channel configuration are not checked.</p>}
        <p>In-app rows are created separately; feed filtering is not proof a row exists. Digest rules, scheduler timing, upstream event conditions, SMTP/webhook availability, actual sends and delivery history are not checked. No event is created or replayed. Preview evaluated at {result.retrievedAt}.</p>
      </section>
    </>}
    <button type="button" disabled={loading || busy} onClick={() => void load()} className={buttonClass}>Read current saved policy</button>
  </div></div>;
}

export function NotificationPolicyPreview() {
  const [open, setOpen] = useState(false);
  return <><Panel title="Understand saved notification policy" description="Test current preference gates without sending an email, creating an event or changing Settings."><div className="space-y-3 p-5"><p className="text-xs text-surface-400">Inspect the saved snapshot and compare severity, kind mutes and UTC quiet hours. Unsaved form edits are not used.</p><button type="button" onClick={() => setOpen(true)} className={buttonClass}>Inspect saved delivery policy</button></div></Panel>{open && <SavedPolicyDialog onClose={() => setOpen(false)} />}</>;
}
