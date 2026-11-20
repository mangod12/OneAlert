import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { StatusBadge } from './ui/StatusBadge';
interface Plan { id: number; case_id: number; status: string; autonomy_level: string; created_by: string; created_at: string; actions: unknown[]; }
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
interface Props { caseId: number; onSeed: (id: number) => void; seedBusy: boolean; tasksUnavailable: boolean; }
export function CaseResponsePlans(props: Props) { return <PlanExplorer key={props.caseId} {...props} />; }
function PlanExplorer({ caseId, onSeed, seedBusy, tasksUnavailable }: Props) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [status, setStatus] = useState('');
  const [snapshot, setSnapshot] = useState<{ caseId: number; page: number; plans: Plan[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setLoading(true); setSnapshot(null); setError('');
    void apiClient.get('/response-plans/', { params: { case_id: caseId, page, size: 10, ...(status ? { status } : {}) } }).then(response => {
      if (request !== requestId.current) return;
      const value = response.data;
      const total = value.total ?? (Array.isArray(value.data) ? value.data.length : undefined);
      if (!Array.isArray(value.data) || !Number.isSafeInteger(total) || total < 0 || (value.page !== undefined && value.page !== page) || (value.size !== undefined && value.size !== 10) || value.data.some((plan: Plan) => !plan || !Number.isSafeInteger(plan.id) || plan.id < 1 || plan.case_id !== caseId || typeof plan.status !== 'string' || !Array.isArray(plan.actions))) throw new Error('The response plans did not match this investigation and page. Retry before opening a plan.');
      const last = Math.max(1, Math.ceil(total / 10)); if (page > last) { setPage(last); return; }
      setSnapshot({ caseId, page, plans: value.data, total });
    }).catch(err => { if (request === requestId.current) setError(getApiErrorMessage(err, 'Response plans could not be loaded.')); })
      .finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [caseId, page, status, retry]);
  const current = snapshot?.caseId === caseId && snapshot.page === page ? snapshot : null;
  return <section aria-label="Investigation response plan explorer" className="oa-panel space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50"><Shield className="h-5 w-5 text-primary-400" />Response Plans</h2><label className="text-xs text-surface-300">Plan status<select aria-label="Filter investigation response plans by status" value={status} className={`${button} ml-2 bg-surface-950`} onChange={event => { setSnapshot(null); setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{['draft', 'pending_approval', 'approved', 'executing', 'completed', 'partial', 'rejected'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label></div>
    <p className="text-xs text-surface-400">Plans visible to your account for this investigation. Open an exact plan's read-only decision evidence. Adding actions to a checklist does not approve or execute the plan.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading investigation response plans...</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className={button} onClick={() => setRetry(retry + 1)}>Retry investigation response plans</button></div>}
    {!loading && !error && current && <>
      {!current.plans.length && <p className="text-sm text-surface-400">No response plans match this investigation and status filter.</p>}
      <div className="space-y-2">{current.plans.map(plan => <div key={plan.id} className="flex flex-col gap-2 rounded border border-surface-700 p-3 sm:flex-row sm:items-center">
        <Link to={`/response-plans?plan=${plan.id}`} className="min-w-0 flex-1 space-y-2 text-sm text-surface-200 hover:text-primary-300"><span className="mr-2 font-semibold">Plan #{plan.id}</span><StatusBadge tone={plan.status === 'rejected' ? 'danger' : plan.status === 'pending_approval' || plan.status === 'partial' ? 'warning' : 'neutral'}>{plan.status.replace('_', ' ')}</StatusBadge><p className="break-words text-xs text-surface-400">{plan.actions.length} actions · {plan.autonomy_level} · {plan.created_by}</p><p className="break-all text-xs text-surface-500">Recorded creation: {plan.created_at || 'Not recorded'}</p></Link>
        {plan.actions.length > 0 && <button type="button" className={button} aria-label={`Seed checklist from plan ${plan.id}`} disabled={tasksUnavailable || seedBusy} onClick={() => onSeed(plan.id)}>Add to checklist</button>}
      </div>)}</div>
      <nav aria-label="Investigation response plan pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" className={button} disabled={page === 1 || seedBusy} onClick={() => setPage(page - 1)}>Previous investigation plans</button><span>Page {page} of {Math.max(1, Math.ceil(current.total / 10))} · {current.total} matching plan records</span><button type="button" className={button} disabled={page * 10 >= current.total || seedBusy} onClick={() => setPage(page + 1)}>Next investigation plans</button><button type="button" className={button} disabled={seedBusy} onClick={() => setRetry(retry + 1)}>Refresh investigation plans</button></nav>
    </>}
  </section>;
}
