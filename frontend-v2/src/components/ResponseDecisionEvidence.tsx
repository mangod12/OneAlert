import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Action { priority?: number | null; action_type?: string | null; target?: string | null; reason?: string | null; policy_check?: { approved?: boolean | null } | null; execution_result?: { status?: string | null; detail?: string | null; executed_at?: string | null } | null; }
interface Evidence { schema_version: number; scope: string; retrieved_at: string; plan: { id: number; case_id: number; status: string; autonomy_level: string; created_by: string; approved_by: number | null; approved_at: string | null; created_at: string; actions: Action[] }; approval_page: number; approval_size: number; approval_total: number; approval_records: { id: number; plan_id: number; requested_by: string | null; status: string; reason: string | null; reviewed_by: number | null; reviewed_at: string | null; created_at: string }[]; }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const recorded = (value: unknown) => value == null || value === '' ? 'Not recorded' : String(value);
export function ResponseDecisionEvidence() {
  const [draft, setDraft] = useState(''), [planId, setPlanId] = useState<number | null>(null), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Evidence | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const [includePeople, setIncludePeople] = useState(false), [actionPage, setActionPage] = useState(1);
  const requestId = useRef(0), panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const request = ++requestId.current; setSnapshot(null); setError(''); setDownloadError(''); setIncludePeople(false); setActionPage(1);
    if (planId === null) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Evidence>(`/response-plans/${planId}/decision-evidence`, { params: { page, size: 10 } }).then(response => {
      if (request !== requestId.current) return;
      const value = response.data;
      if (value.plan?.id !== planId || !Array.isArray(value.plan.actions) || value.plan.actions.some(action => !action || typeof action !== 'object' || Array.isArray(action)) || !Array.isArray(value.approval_records) || value.approval_records.some(row => row.plan_id !== planId) || value.approval_page !== page || value.approval_size !== 10) throw new Error('Decision evidence did not match this plan and page. Try again.');
      const lastPage = Math.max(1, Math.ceil(value.approval_total / 10)); if (page > lastPage) { setPage(lastPage); return; }
      setSnapshot(value);
    }).catch(err => { if (request === requestId.current) setError(getApiErrorMessage(err, 'Response decision evidence could not be loaded.')); })
      .finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [planId, page, retry]);
  const review = () => {
    if (!/^[1-9][0-9]*$/.test(draft.trim()) || !Number.isSafeInteger(Number(draft))) { requestId.current += 1; setPlanId(null); setSnapshot(null); setLoading(false); setError('Enter a positive plan record ID.'); return; }
    setPlanId(Number(draft)); setPage(1); setRetry(value => value + 1);
  };
  const download = () => {
    if (!snapshot || loading || error) return;
    setDownloadError('');
    try {
      const { created_by, approved_by, ...plan } = snapshot.plan;
      const approvals = snapshot.approval_records.map(({ requested_by, reviewed_by, ...row }) => includePeople ? { ...row, requested_by, reviewed_by } : row);
      const body = { ...snapshot, exported_at: new Date().toISOString(), export_scope: 'The complete loaded plan action list and only the loaded approval-request page. Action targets, reasons and recorded result details are included. Review before sharing. This download does not approve or run actions.', actor_identities_included: includePeople, plan: includePeople ? { ...plan, created_by, approved_by } : plan, approval_records: approvals };
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `response-plan-${snapshot.plan.id}-decision-evidence-page-${snapshot.approval_page}.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('Decision evidence could not be downloaded. The loaded record remains visible.'); }
  };
  return <section ref={panel} className="oa-panel scroll-mt-20 space-y-4 p-4 sm:p-6" aria-label="Read-only response decision evidence">
    <h2 className="text-lg font-semibold text-surface-100">Review recorded decision evidence</h2>
    <p className="text-xs text-surface-400">Open an owned plan by exact ID, including plans outside the current list or status filter. This is read-only. It does not approve, reject, execute or delete a plan. Approval-request rows are mutable records, not an immutable decision log.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); review(); }}><label className="text-xs text-surface-300">Plan record ID<input aria-label="Decision evidence plan ID" inputMode="numeric" value={draft} onChange={event => { requestId.current += 1; setDraft(event.target.value); setPlanId(null); setSnapshot(null); setLoading(false); setError(''); }} className={`${control} mt-1 block w-full`} /></label><button type="submit" className={control}>Load decision evidence</button></form>
    {loading && <p role="status" className="text-sm text-surface-300">Loading recorded decision evidence...</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p>{planId !== null && <button type="button" className={control} onClick={() => setRetry(retry + 1)}>Retry decision evidence</button>}</div>}
    {!loading && !error && snapshot && <>
      <div className="space-y-2 rounded border border-surface-700 p-3 text-sm text-surface-300"><h3 className="font-semibold text-surface-100">Plan #{snapshot.plan.id} · Case #{snapshot.plan.case_id}</h3><p>Saved plan status: {snapshot.plan.status} · Autonomy: {snapshot.plan.autonomy_level}</p><p className="break-words text-xs">Created {recorded(snapshot.plan.created_at)} · Approval timestamp {recorded(snapshot.plan.approved_at)}</p><p className="break-words text-xs text-surface-400">Response received {snapshot.retrieved_at}. Stored statuses do not prove a new decision or live action outcome.</p><details className="text-xs"><summary className="cursor-pointer text-primary-300">Inspect recorded plan actors</summary><p className="mt-2 break-words">Created by: {recorded(snapshot.plan.created_by)} · Approver ID: {recorded(snapshot.plan.approved_by)}</p></details></div>
      <label className="flex items-start gap-2 text-xs text-surface-300"><input type="checkbox" checked={includePeople} onChange={event => setIncludePeople(event.target.checked)} />Include recorded actor identities and reviewer IDs in JSON</label>
      <p className="text-xs text-surface-400">JSON includes the complete loaded action list, targets, reasons and result details, but only the currently loaded approval page. Actor identities are excluded unless selected. Check free-text details before sharing, as they may name people or systems.</p>
      <button type="button" className={control} onClick={download}>Download loaded decision evidence JSON</button>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
      <h3 className="text-sm font-semibold text-surface-100">Recorded actions ({snapshot.plan.actions.length})</h3>
      <p className="text-xs text-surface-400">Missing results do not establish whether an action ran. Policy flags and plan approval are recorded separately from execution results.</p>
      {snapshot.plan.actions.length === 0 && <p className="text-xs text-surface-300">No actions are recorded in this loaded plan.</p>}
      <ol className="space-y-3">{snapshot.plan.actions.slice((actionPage - 1) * 10, actionPage * 10).map((action, index) => <li key={(actionPage - 1) * 10 + index} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h4 className="break-all font-semibold text-surface-100">Action position {(actionPage - 1) * 10 + index + 1}: {recorded(action.action_type)}</h4><p className="break-all">Target: {recorded(action.target)}</p><p>Recorded priority: {recorded(action.priority)} · Policy approval flag: {action.policy_check?.approved === true ? 'Approved flag' : action.policy_check?.approved === false ? 'Not approved flag' : 'Not recorded'}</p><p className="whitespace-pre-wrap break-words">Reason: {recorded(action.reason)}</p><p>Execution status: {recorded(action.execution_result?.status)}</p><p className="whitespace-pre-wrap break-words">Execution detail: {recorded(action.execution_result?.detail)}</p><p className="break-all">Execution time: {recorded(action.execution_result?.executed_at)}</p></li>)}</ol>
      {snapshot.plan.actions.length > 10 && <nav aria-label="Decision evidence action pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" className={control} disabled={actionPage === 1} onClick={() => setActionPage(actionPage - 1)}>Previous recorded actions</button><span>Page {actionPage} of {Math.ceil(snapshot.plan.actions.length / 10)}</span><button type="button" className={control} disabled={actionPage * 10 >= snapshot.plan.actions.length} onClick={() => setActionPage(actionPage + 1)}>More recorded actions</button></nav>}
      <h3 className="text-sm font-semibold text-surface-100">Recorded approval requests ({snapshot.approval_total})</h3>
      <p className="text-xs text-surface-400">Page {snapshot.approval_page} of {Math.max(1, Math.ceil(snapshot.approval_total / snapshot.approval_size))}, newest created request first. These rows may have been updated in place and are not a full transition history.</p>
      {!snapshot.approval_records.length && <p className="text-xs text-surface-300">No approval-request rows are recorded for this plan. This does not establish whether an approval occurred elsewhere.</p>}
      <ol className="space-y-3">{snapshot.approval_records.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h4 className="font-semibold text-surface-100">Request #{row.id} · {row.status}</h4><p className="break-all">Created: {recorded(row.created_at)} · Reviewed: {recorded(row.reviewed_at)}</p><p className="whitespace-pre-wrap break-words">Recorded reason: {recorded(row.reason)}</p><details><summary className="cursor-pointer text-primary-300">Inspect recorded request actors</summary><p className="mt-2 break-words">Requested by: {recorded(row.requested_by)} · Reviewer ID: {recorded(row.reviewed_by)}</p></details></li>)}</ol>
      <nav aria-label="Decision evidence approval pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous approval requests</button><button type="button" className={control} disabled={page * snapshot.approval_size >= snapshot.approval_total} onClick={() => setPage(page + 1)}>More approval requests</button><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Refresh decision evidence</button></nav>
    </>}
  </section>;
}
