import { useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { useDialogFocus } from '../ui/useDialogFocus';
export interface SuppressionDraft { name: string; cve_id?: string; asset_id?: number; severity?: string; title_contains?: string; duration_hours: number }
interface Snapshot { proposal: SuppressionDraft & { enabled: boolean }; active_alert_count: number; matching_alert_count: number; example_limit: number; previewed_at: string; examples: { id: number; asset_id: number; title: string; cve_id: string | null; severity: string; status: string }[] }
const fields = ['name', 'cve_id', 'asset_id', 'severity', 'title_contains', 'duration_hours'] as const;
export function SuppressionDraftPreview({ proposal, onClose }: { proposal: SuppressionDraft; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null); useDialogFocus(dialog, onClose);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setSnapshot(null); setError('');
    void apiClient.post<Snapshot>('/suppression-rules/preview', proposal).then(({ data }) => {
      if (!active) return;
      if (!data.proposal || fields.some(field => (data.proposal[field] ?? null) !== (proposal[field] ?? null)) || data.proposal.enabled !== true || !Number.isSafeInteger(data.active_alert_count) || !Number.isSafeInteger(data.matching_alert_count) || data.matching_alert_count < 0 || data.active_alert_count < data.matching_alert_count || data.example_limit !== 10 || !Array.isArray(data.examples) || data.examples.length > 10 || data.examples.length > data.matching_alert_count || data.examples.some(row => !Number.isSafeInteger(row.id) || row.id <= 0)) throw new Error('The preview did not match this draft. Refresh before relying on it.');
      setSnapshot(data);
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Draft scope could not be previewed.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [proposal, retry]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Suppression draft scope preview" className="max-h-[90dvh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 text-surface-300">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Preview suppression draft scope</h2><button type="button" onClick={onClose} className="rounded border border-surface-600 px-3 py-2 text-xs">Close draft preview</button></div>
    <p className="text-sm text-surface-400">Read-only check. No rule was saved or applied, and no alert was snoozed. Current active-alert matches do not predict future volume, show historical suppression or account for which competing rule wins. Close this preview to edit or create the rule separately.</p>
    <section className="space-y-2 rounded border border-surface-700 p-3 text-xs [overflow-wrap:anywhere]"><h3 className="font-semibold text-surface-100">Frozen draft: {proposal.name}</h3><p>Would be enabled for new matching alerts with a {proposal.duration_hours}h snooze window.</p><dl className="grid gap-3 sm:grid-cols-2">{Object.entries({ 'CVE (exact, case-insensitive)': proposal.cve_id, 'Asset ID (exact)': proposal.asset_id, 'Severity (exact, case-insensitive)': proposal.severity, 'Title contains (literal, case-insensitive)': proposal.title_contains }).map(([field, value]) => <div key={field}><dt className="text-surface-400">{field}</dt><dd className="whitespace-pre-wrap">{value ?? 'Not set, no restriction'}</dd></div>)}</dl><p>All set criteria must match. Preview uses the same criterion matcher as automatic suppression.</p></section>
    {loading && <p role="status">Checking current active alerts...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!loading && !error && snapshot && <><p className="text-sm">{snapshot.matching_alert_count} of {snapshot.active_alert_count} current active alerts match this draft.</p><p className="text-xs text-surface-400">Active means pending, sent or acknowledged. Showing {snapshot.examples.length} newest matching alert IDs, at most {snapshot.example_limit} examples, not the full match list. Read at {snapshot.previewed_at}.</p>{snapshot.matching_alert_count === 0 && <p className="text-sm text-warning">No matches now does not make this rule safe for future alerts.</p>}<ol className="space-y-2">{snapshot.examples.map(row => <li key={row.id} className="space-y-2 rounded border border-surface-700 p-3 text-sm [overflow-wrap:anywhere]"><h3 className="font-semibold text-surface-100">Alert #{row.id}: {row.title}</h3><p>{row.severity} · {row.status} · Asset #{row.asset_id} · {row.cve_id || 'No CVE recorded'}</p><a href={`/app/alerts?alert=${row.id}`} className="inline-block text-xs text-primary-300">Open exact example alert #{row.id}</a></li>)}</ol></>}
    <button type="button" disabled={loading} onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Refresh draft scope</button>
  </div></div>;
}
