import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Alert { id: number; title: string; severity: string; status: string; cve_id: string | null; created_at: string | null }
interface Preview { asset_id: number; asset_name: string; title: string; summary: string; severity: string; status: string; due_date: string | null; reviewed_fingerprint: string; alerts: Alert[]; existing_cases: { id: number; title: string; status: string }[] }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 disabled:opacity-40';
export function IncidentEscalationReview({ assetId, onClose, onCreated }: { assetId: number; onClose: () => void; onCreated: (id: number) => void }) {
  const dialog = useRef<HTMLDivElement>(null), pending = useRef(false), mounted = useRef(true);
  const [preview, setPreview] = useState<Preview | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [writeError, setWriteError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0), [page, setPage] = useState(1), [newDespiteExisting, setNewDespiteExisting] = useState(false);
  useDialogFocus(dialog, () => { if (!pending.current) onClose(); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setPreview(null); setError(''); setWriteError(''); setLoading(true); setPage(1); setNewDespiteExisting(false);
    void apiClient.get(`/incidents/${assetId}/escalation-preview`).then(response => {
      if (!active) return;
      const value: Preview = response.data;
      if (!value || value.asset_id !== assetId || typeof value.asset_name !== 'string' || typeof value.title !== 'string' || typeof value.summary !== 'string' || typeof value.severity !== 'string' || value.status !== 'open' || (value.due_date !== null && typeof value.due_date !== 'string') || typeof value.reviewed_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewed_fingerprint) || !Array.isArray(value.alerts) || !value.alerts.length || new Set(value.alerts.map(row => row?.id)).size !== value.alerts.length || value.alerts.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.title !== 'string' || typeof row.severity !== 'string' || !['pending', 'sent', 'acknowledged'].includes(row.status) || (row.cve_id !== null && typeof row.cve_id !== 'string') || (row.created_at !== null && typeof row.created_at !== 'string')) || !Array.isArray(value.existing_cases) || new Set(value.existing_cases.map(row => row?.id)).size !== value.existing_cases.length || value.existing_cases.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.title !== 'string' || typeof row.status !== 'string')) throw new Error('The escalation preview did not identify this exact asset, proposal and active evidence. Refresh before creating an investigation.');
      setPreview(value);
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Escalation preview unavailable. No investigation was created.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assetId, retry]);
  const create = async () => {
    if (pending.current || loading || !preview || writeError || error || (preview.existing_cases.length > 0 && !newDespiteExisting)) return;
    pending.current = true; setBusy(true);
    try {
      const response = await apiClient.post(`/incidents/${assetId}/escalate`, { reviewed_fingerprint: preview.reviewed_fingerprint });
      if (!mounted.current) return;
      const value = response.data;
      const ids = preview.alerts.map(row => row.id).sort((a, b) => a - b);
      if (!value || !Number.isSafeInteger(value.id) || value.id < 1 || value.asset_id !== assetId || value.reviewed_fingerprint !== preview.reviewed_fingerprint || value.title !== preview.title || value.severity !== preview.severity || value.alerts_linked !== ids.length || !Array.isArray(value.alert_ids) || JSON.stringify([...value.alert_ids].sort((a, b) => a - b)) !== JSON.stringify(ids)) throw new Error('The reply did not confirm the exact reviewed investigation and linked evidence.');
      onCreated(value.id);
    } catch (err) { if (mounted.current) setWriteError(getApiErrorMessage(err, 'Investigation creation could not be confirmed.')); }
    finally { if (mounted.current) { pending.current = false; setBusy(false); } }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review incident escalation" className="max-h-[90dvh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5">
    <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Review a new investigation</h2><button type="button" className={control} disabled={busy} onClick={onClose}>Cancel</button></div>
    <p className="text-xs text-surface-400">Preview only until you confirm. This creates one new investigation and links every active alert listed in this review. It does not change alert statuses, merge existing investigations, run a response plan or perform external remediation.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading current escalation evidence...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {preview && !error && <><p className="break-words text-sm text-surface-100">Asset #{preview.asset_id}: {preview.asset_name}</p><dl className="space-y-2 break-words text-sm text-surface-300"><div><dt>New investigation title</dt><dd className="font-semibold text-surface-100">{preview.title}</dd></div><div><dt>Initial state and due date</dt><dd>{preview.status} · {preview.severity} · {preview.due_date ?? 'No SLA due date'}</dd></div><div><dt>Summary to save</dt><dd>{preview.summary}</dd></div></dl>
      {preview.existing_cases.length > 0 && <div className="space-y-3 rounded border border-warning/40 p-3 text-sm text-warning"><p>These existing investigations already link at least one reviewed active alert. Creating another investigation will not reuse or close them.</p><ul className="space-y-2">{preview.existing_cases.map(row => <li key={row.id} className="break-words"><Link className="text-primary-300" aria-disabled={busy} onClick={event => { if (pending.current) event.preventDefault(); }} to={`/cases/${row.id}`}>Investigation #{row.id}: {row.title}</Link> · {row.status.replaceAll('_', ' ')}</li>)}</ul><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 shrink-0" checked={newDespiteExisting} disabled={busy || !!writeError} onChange={event => setNewDespiteExisting(event.target.checked)} /><span>I reviewed existing investigations and want a new investigation.</span></label></div>}
      <p className="text-xs text-surface-400">All {preview.alerts.length} active alert records below will be linked, including records on other review pages. Resolved alerts and other users' records are excluded. Initial severity and the saved SLA due date come from this current proposal, not an immutable incident record.</p>
      <ol aria-label="Reviewed incident alert evidence" className="space-y-2">{preview.alerts.slice((page - 1) * 20, page * 20).map(row => <li key={row.id} className="space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300"><p className="break-words font-semibold text-surface-100">Alert #{row.id}: {row.title}</p><p className="break-words">{row.severity} · {row.status} · {row.cve_id ?? 'No CVE recorded'}</p><p>{row.created_at ? new Date(row.created_at).toLocaleString() : 'Creation time not recorded'}</p></li>)}</ol>
      <nav aria-label="Escalation evidence pages" className="flex flex-wrap items-center gap-2"><button type="button" className={control} disabled={busy || page === 1} onClick={() => setPage(page - 1)}>Previous review page</button><span className="text-xs text-surface-400">Review page {page} of {Math.max(1, Math.ceil(preview.alerts.length / 20))}</span><button type="button" className={control} disabled={busy || page * 20 >= preview.alerts.length} onClick={() => setPage(page + 1)}>Next review page</button></nav>
    </>}
    {writeError && <p role="alert" className="text-sm text-danger">{writeError} Do not blindly retry. Refresh this preview and inspect its existing investigations first. A previous request may already have created one.</p>}
    <p className="text-xs text-warning">Creation is refused if the reviewed active evidence, proposal or linked investigations changed. Refreshing replaces this review and clears its acknowledgement.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy || loading} onClick={() => setRetry(value => value + 1)}>Refresh escalation preview</button><button type="button" className={control} disabled={busy || loading || !preview || !!error || !!writeError || (!!preview?.existing_cases.length && !newDespiteExisting)} onClick={() => void create()}>{busy ? 'Creating reviewed investigation...' : 'Create reviewed investigation'}</button></div>
  </div></div>;
}
