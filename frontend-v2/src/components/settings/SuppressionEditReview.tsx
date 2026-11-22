import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { buildSuppressionEditProposal, checkedSuppressionEditBase, checkedSuppressionEditPreview, checkedSuppressionEditResult, suppressionEditBuckets, suppressionEditFields, suppressionEditKeys, type SuppressionEditBase, type SuppressionEditFields, type SuppressionEditPreview } from '../../utils/suppressionEditReview';
import { suppressionCriteriaPresent, type SuppressionRuleSnapshot } from '../../utils/suppressionStatusReview';
import { useDialogFocus } from '../ui/useDialogFocus';

const labels = { name: 'Rule name', cve_id: 'CVE, case-insensitive exact', asset_id: 'Asset record ID, exact', severity: 'Severity, case-insensitive exact', title_contains: 'Title contains, literal and case-insensitive', duration_hours: 'Snooze hours' };
const bucketLabels = { retained: 'Match both criteria sets', added: 'Match proposed criteria only', removed: 'Match saved criteria only' };
const inputClass = 'mt-1 w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100';
const buttonClass = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
const display = (value: string | number | null) => value === null ? 'Unset, no restriction' : value === '' ? 'Empty string, no restriction' : JSON.stringify(value);

export function SuppressionEditReview({ ruleId, onClose, onSaved }: { ruleId: number; onClose: () => void; onSaved: (rule: SuppressionRuleSnapshot) => void }) {
  const dialog = useRef<HTMLDivElement>(null), generation = useRef(0), operation = useRef(false);
  const close = () => { if (!operation.current) onClose(); };
  useDialogFocus(dialog, close);
  const [base, setBase] = useState<SuppressionEditBase | null>(null), [fields, setFields] = useState<SuppressionEditFields | null>(null);
  const [preview, setPreview] = useState<SuppressionEditPreview | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++generation.current;
    setLoading(true); setBase(null); setFields(null); setPreview(null); setError(''); setConfirmed(false);
    try {
      if (!Number.isSafeInteger(ruleId) || ruleId <= 0) throw Error('Invalid rule identity');
      const { data } = await apiClient.get(`/suppression-rules/${ruleId}/edit-review`);
      const checked = await checkedSuppressionEditBase(data, ruleId);
      if (request !== generation.current) return;
      setBase(checked); setFields(suppressionEditFields(checked.rule));
    } catch { if (request === generation.current) setError('The current saved rule could not be verified. No edit was sent. Read it again. Secure hashing support is required.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [ruleId]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const reviewDraft = async () => {
    if (!base || !fields || operation.current || loading) return;
    let proposal;
    try { proposal = buildSuppressionEditProposal(fields, base.rule); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the draft values.'); return; }
    operation.current = true; setBusy(true); setError(''); setPreview(null); const request = generation.current;
    try {
      const { data } = await apiClient.post(`/suppression-rules/${base.rule.id}/edit-preview`, { expected_fingerprint: base.fingerprint, proposal });
      const checked = await checkedSuppressionEditPreview(data, base, proposal);
      if (request === generation.current) setPreview(checked);
    } catch (failure: unknown) {
      if (request !== generation.current) return;
      setBase(null); setFields(null);
      const status = (failure as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? 'The saved rule changed or this draft had no saved-value changes. No edit was made. Read the saved rule again.' : status === 422 ? 'The preview was refused. A valid criterion and at most 50,000 current active alerts are required; no partial counts or edit were returned. Read the saved rule again.' : 'The draft preview could not be verified. No edit was sent. Read the saved rule again.');
    } finally { operation.current = false; if (request === generation.current) setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || operation.current || confirmed || error || loading) return;
    operation.current = true; setBusy(true); setError(''); const request = generation.current;
    try {
      const { data } = await apiClient.post(`/suppression-rules/${preview.rule.id}/reviewed-edit`, { expected_fingerprint: preview.fingerprint, proposal: preview.proposal });
      const rule = await checkedSuppressionEditResult(data, preview);
      if (request !== generation.current) return;
      setConfirmed(true); onSaved(rule);
    } catch (failure: unknown) {
      if (request !== generation.current) return;
      setBase(null); setFields(null); setPreview(null);
      const status = (failure as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? 'The saved rule or selected asset ownership changed during review, or the edit was already present. No edit was made for this request. Read the saved rule before reviewing again.' : 'The edit outcome could not be verified. It may already have applied. Read the saved rule before any retry. No automatic retry was sent.');
    } finally { operation.current = false; if (request === generation.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review saved suppression rule edit" className="max-h-[90dvh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 text-surface-300 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Edit saved suppression rule #{ruleId}</h2><button type="button" disabled={busy} onClick={close} className={buttonClass}>Close edit review</button></div>
    <p className="text-sm text-surface-400">Edit the name, criteria or snooze window without deleting and recreating the rule. Enabled or paused status stays unchanged. Existing alerts are not snoozed, unsnoozed or otherwise changed by this edit.</p>
    {loading && <p role="status">Reading the complete saved rule...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {base && <p className="text-xs">Rule #{base.rule.id} is {base.rule.enabled ? 'enabled and will remain enabled' : 'paused and will remain paused'}. Created {base.rule.created_at}. Saved values read at {base.retrievedAt}.</p>}
    {base && !suppressionCriteriaPresent(base.rule) && <p className="text-xs text-warning">The legacy saved rule has no criteria and automatic suppression skips it. Add a criterion to repair it; an empty rule is not treated as a current match-all rule.</p>}
    {base && fields && !preview && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void reviewDraft(); }}>
      <p className="text-xs text-surface-400">All set criteria must match. Empty criteria impose no restriction. Text spaces are kept literally, not trimmed. Asset IDs must belong to your account. A snooze window is 1 to 720 whole hours.</p>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">{suppressionEditKeys.map(key => <label key={key} className="min-w-0 text-xs text-surface-300">{labels[key]}
        {key === 'severity' ? <select aria-label={labels[key]} value={fields[key]} onChange={event => { const value = event.target.value; setFields(current => current && { ...current, [key]: value }); }} className={inputClass}><option value="">Any severity</option>{['low', 'medium', 'high', 'critical'].map(value => <option key={value} value={value}>{value}</option>)}</select>
          : <input aria-label={labels[key]} value={fields[key]} inputMode={key === 'asset_id' || key === 'duration_hours' ? 'numeric' : undefined} maxLength={key === 'name' ? 200 : 16384} onChange={event => { const value = event.target.value; setFields(current => current && { ...current, [key]: value }); }} className={inputClass} />}
      </label>)}</fieldset>
      <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Reading current match delta...' : 'Preview exact saved-rule edit'}</button>
    </form>}
    {preview && <>
      <section aria-label="Exact reviewed saved-value changes" className="space-y-3 rounded border border-surface-700 p-3"><h3 className="font-semibold text-surface-100">Saved values to proposed values</h3>
        <dl className="grid gap-3 sm:grid-cols-2">{suppressionEditKeys.map(key => <div key={key} className="min-w-0 rounded bg-surface-950/50 p-3 text-xs"><dt className="mb-2 font-medium text-surface-100">{labels[key]}{preview.rule[key] !== preview.proposed[key] ? ' (changed)' : ' (unchanged)'}</dt><dd className="space-y-1 whitespace-pre-wrap"><p><span className="text-surface-400">Saved: </span>{display(preview.rule[key])}</p><p><span className="text-primary-300">Proposed: </span>{display(preview.proposed[key])}</p></dd></div>)}</dl>
      </section>
      <section aria-label="Current selected-criteria match delta" className="space-y-3"><h3 className="font-semibold text-surface-100">Current criteria comparison, not future impact</h3><p className="text-sm">{preview.beforeCount} match the saved criteria; {preview.afterCount} match the proposed criteria. Compared {preview.activeCount} owned active alert rows, whether this rule is enabled or paused.</p>
        <div className="grid gap-3 sm:grid-cols-3">{suppressionEditBuckets.map(key => <section key={key} aria-label={bucketLabels[key]} className="rounded border border-surface-700 p-3"><p className="text-xs text-surface-400">{bucketLabels[key]}</p><p className="mt-1 text-2xl font-semibold text-surface-100">{preview.counts[key]}</p></section>)}</div>
        <p className="text-xs text-surface-400">Active means pending, sent or acknowledged. Complete preview is refused above 50,000 owned active rows; examples are at most ten highest alert IDs per group. This does not account for other rules, determine which rule wins, prove past suppression or predict future volume. Zero added matches is not a safety guarantee.</p>
        <p className="text-xs text-surface-400">Rule values and alert rows are separate current reads, not a frozen transaction. Preview read at {preview.retrievedAt}. Confirmation checks the complete saved rule values and selected asset ownership, not these counts. Later changes remain possible.</p>
        {suppressionEditBuckets.map(key => <details key={key} className="rounded border border-surface-700 p-3 text-xs"><summary className="cursor-pointer text-surface-100">{bucketLabels[key]}: {preview.examples[key].length} current examples</summary><ol className="mt-3 space-y-2">{preview.examples[key].map(alert => <li key={alert.id} className="space-y-1 rounded bg-surface-950/50 p-3"><p>Alert #{alert.id}: {alert.title}</p><p>{alert.severity} · {alert.status} · Asset {alert.asset_id ?? 'not recorded'} · {alert.cve_id || 'No CVE recorded'}</p><a href={busy ? undefined : `/app/alerts?alert=${alert.id}`} aria-disabled={busy} className="inline-block text-primary-300">Open exact current alert #{alert.id}</a></li>)}</ol></details>)}
      </section>
      {confirmed ? <p role="status" className="text-sm text-success">The conditional edit was confirmed with the exact reviewed values. Enabled status and rule identity were preserved. An audit entry was recorded; existing alerts were not changed. Other sessions can still change this rule afterward.</p> : <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => { setPreview(null); setError(''); }} className={buttonClass}>Back to draft</button><button type="button" disabled={busy || Boolean(error)} onClick={() => void confirm()} className="rounded bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Confirming conditional edit...' : 'Confirm reviewed rule edit'}</button></div>}
    </>}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={loading || busy} onClick={() => void load()} className={buttonClass}>{base && !confirmed ? 'Discard draft and read current rule' : 'Read current saved rule'}</button>{base && <a href={busy ? undefined : `/app/settings/suppression-rules/${base.rule.id}/overlap`} aria-disabled={busy} className="inline-block py-2 text-xs text-primary-300">Inspect saved-current overlap, not this draft</a>}</div>
  </div></div>;
}
