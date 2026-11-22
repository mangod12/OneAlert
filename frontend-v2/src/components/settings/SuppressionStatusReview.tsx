import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { checkedSuppressionReview, checkedSuppressionStatusResult, type SuppressionReview, type SuppressionRuleSnapshot } from '../../utils/suppressionStatusReview';
import { useDialogFocus } from '../ui/useDialogFocus';

export function SuppressionStatusReview({ ruleId, enabled, onClose, onSaved }: { ruleId: number; enabled: boolean; onClose: () => void; onSaved: (rule: SuppressionRuleSnapshot) => void }) {
  const dialog = useRef<HTMLDivElement>(null), generation = useRef(0), operation = useRef(false);
  const close = () => { if (!operation.current) onClose(); };
  useDialogFocus(dialog, close);
  const [review, setReview] = useState<SuppressionReview | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmed, setConfirmed] = useState(false);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++generation.current; setLoading(true); setReview(null); setError(''); setNotice(''); setConfirmed(false);
    try {
      if (!Number.isSafeInteger(ruleId) || ruleId <= 0) throw Error('Invalid record ID');
      const { data } = await apiClient.get(`/suppression-rules/${ruleId}/matching-alerts`, { params: { page: 1, size: 10, scope: 'active', search: '' } });
      const checked = await checkedSuppressionReview(data, ruleId);
      if (request !== generation.current) return;
      setReview(checked);
      if (checked.rule.enabled === enabled) setNotice('The current rule already has the requested status. No status request is needed or sent.');
    } catch { if (request === generation.current) setError('The current rule and its match evidence could not be verified. No status request was sent. Read the rule again. Secure hashing support is required.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [ruleId, enabled]);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const confirm = async () => {
    if (!review || operation.current || loading || error || confirmed || review.rule.enabled === enabled || enabled && !review.criteriaPresent) return;
    operation.current = true; setSaving(true); setError(''); setNotice(''); const request = generation.current;
    try {
      const { data } = await apiClient.post(`/suppression-rules/${ruleId}/reviewed-status`, { expected_fingerprint: review.fingerprint, enabled });
      const rule = await checkedSuppressionStatusResult(data, review, enabled);
      if (request !== generation.current) return;
      setConfirmed(true); setNotice('The conditional status change was confirmed with the reviewed criteria and snooze window unchanged. Other sessions can still change the rule afterward. No existing alert was changed.'); onSaved(rule);
    } catch (failure: unknown) {
      if (request !== generation.current) return;
      setReview(null);
      const status = (failure as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? 'The saved rule no longer matched the review or already had the requested status. The server made no status change for this request. Read current rule evidence before reviewing again.' : 'The status change outcome could not be verified. It may already have applied. Read current rule evidence before any retry. No automatic retry was sent.');
    } finally { operation.current = false; if (request === generation.current) setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review suppression status change" className="max-h-[90dvh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 text-surface-300">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Review {enabled ? 'enabling' : 'pausing'} suppression rule #{ruleId}</h2><button type="button" disabled={saving} onClick={close} className="rounded border border-surface-600 px-3 py-2 text-xs disabled:opacity-40">Close status review</button></div>
    <p className="text-sm text-surface-400">This changes only whether the saved rule can snooze new matching alerts. It does not snooze, unsnooze or otherwise change existing alerts. Current matches are not future volume, historical suppression or proof this rule wins over competing rules.</p>
    <p className="text-xs text-surface-400">Confirmation uses a conditional database update against the reviewed rule values, including criteria, duration and creation identity. Changed values refuse the update. This is not a revision history or a lock against later changes. Alert counts and examples are a separate current read, not part of the condition.</p>
    {loading && <p role="status">Reading current rule and active-alert evidence...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-surface-200">{notice}</p>}
    {review && <>
      <section aria-label="Reviewed saved suppression rule" className="space-y-3 rounded border border-surface-700 p-3 text-xs [overflow-wrap:anywhere]">
        <h3 className="font-semibold text-surface-100">Rule #{review.rule.id}: {review.rule.name}</h3>
        <p className="text-sm">{review.rule.enabled ? 'Enabled' : 'Paused'} to {enabled ? 'Enabled' : 'Paused'} · Snooze window remains {review.rule.duration_hours} hours.</p>
        <dl className="grid gap-3 sm:grid-cols-2">{Object.entries({ 'CVE, case-insensitive exact': review.rule.cve_id, 'Asset record ID, exact': review.rule.asset_id, 'Severity, case-insensitive exact': review.rule.severity, 'Title contains, literal and case-insensitive': review.rule.title_contains, 'Rule created, as recorded': review.rule.created_at }).map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="whitespace-pre-wrap">{value === null || value === '' ? 'Not set, no restriction' : value}</dd></div>)}</dl>
        <p>All set criteria must match. Unset criteria impose no restriction.</p>
        {!review.criteriaPresent && <p role="alert" className="text-warning">This legacy rule has no criteria. Enabling it is blocked. Pausing is allowed; the current automatic suppression service skips empty-criteria rules.</p>}
      </section>
      <p className="text-sm">{review.total} currently active alerts match the saved criteria. Showing {review.alerts.length} highest matching alert IDs, at most 10. Active means pending, sent or acknowledged.</p>
      <p className="text-xs text-surface-400">Rule and alert rows are separate reads. Read at {review.retrievedAt}. Zero matches now does not make enabling safe for future alerts.</p>
      <ol className="space-y-2">{review.alerts.map(row => <li key={row.id} className="space-y-2 rounded border border-surface-700 p-3 text-xs [overflow-wrap:anywhere]"><h3 className="font-medium text-surface-100">Alert #{row.id}: {row.title}</h3><p>{row.severity} · {row.status} · Asset {row.asset_id ?? 'not recorded'} · {row.cve_id || 'No CVE recorded'}</p><a href={saving ? undefined : `/app/alerts?alert=${row.id}`} aria-disabled={saving} className="inline-block text-primary-300">Open exact current alert #{row.id}</a></li>)}</ol>
      <a href={saving ? undefined : `/app/settings/suppression-rules/${review.rule.id}`} aria-disabled={saving} className="inline-block text-xs text-primary-300">Inspect the full current match list for rule #{review.rule.id}</a>
    </>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={loading || saving} onClick={() => void load()} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Read current rule evidence</button>
      {review && !confirmed && review.rule.enabled !== enabled && <button type="button" disabled={loading || saving || Boolean(error) || enabled && !review.criteriaPresent} onClick={() => void confirm()} className="rounded bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 disabled:opacity-40">{saving ? 'Confirming conditional change...' : enabled ? 'Confirm reviewed enable' : 'Confirm reviewed pause'}</button>}
    </div>
  </div></div>;
}
