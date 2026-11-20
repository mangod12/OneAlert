import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { compareActionPositions } from '../utils/responsePlanComparison';
interface Plan { id: number; case_id: number; status: string; autonomy_level: string; actions: unknown[]; }
interface Snapshot { before: Plan; after: Plan; loadedAt: string; }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function ResponsePlanComparison() {
  const [open, setOpen] = useState(false), [beforeId, setBeforeId] = useState(''), [afterId, setAfterId] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [page, setPage] = useState(1), [changedOnly, setChangedOnly] = useState(true);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current += 1; }, []);
  const reset = () => { requestId.current += 1; setSnapshot(null); setError(''); setLoading(false); setPage(1); };
  const load = async () => {
    reset();
    if (![beforeId, afterId].every(value => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))) || beforeId === afterId) { setError('Enter two different positive plan IDs.'); return; }
    const request = requestId.current; setLoading(true);
    try {
      const responses = await Promise.all([apiClient.get(`/response-plans/${beforeId}`), apiClient.get(`/response-plans/${afterId}`)]);
      if (requestId.current !== request) return;
      const plans = responses.map(response => response.data as Plan);
      if (plans.some((plan, index) => !plan || plan.id !== Number(index === 0 ? beforeId : afterId) || !Number.isSafeInteger(plan.case_id) || plan.case_id < 1 || typeof plan.status !== 'string' || typeof plan.autonomy_level !== 'string' || !Array.isArray(plan.actions) || plan.actions.length > 1000)) throw new Error('The returned plan evidence did not match the requested records. No comparison is shown.');
      if (plans[0].case_id !== plans[1].case_id) throw new Error('These plans belong to different investigations. Choose two plans from the same investigation.');
      setSnapshot({ before: plans[0], after: plans[1], loadedAt: new Date().toISOString() });
    } catch (err) { if (requestId.current === request) setError(getApiErrorMessage(err, 'Both plan records are required. No comparison is shown.')); }
    finally { if (requestId.current === request) setLoading(false); }
  };
  const rows = snapshot ? compareActionPositions(snapshot.before.actions, snapshot.after.actions) : [];
  const visible = changedOnly ? rows.filter(row => row.change !== 'unchanged') : rows;
  const lastPage = Math.max(1, Math.ceil(visible.length / 10));
  return <section aria-label="Saved response plan comparison" className="oa-panel space-y-4 p-4 sm:p-6">
    <button type="button" aria-expanded={open} className="text-left text-sm font-semibold text-primary-300" onClick={() => { reset(); setOpen(!open); }}>Compare two saved response plans</button>
    {open && <>
      <p className="text-xs text-surface-400">Read-only comparison of two current saved plans from the same investigation. Stored action positions are aligned, not action identities. Reordering may appear as changes. These separate reads are not an atomic snapshot or an immutable version history. Differences are not proof of execution.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void load(); }}><label className="space-y-1 text-xs text-surface-300">Baseline plan ID<input aria-label="Baseline plan ID" inputMode="numeric" value={beforeId} onChange={event => { reset(); setBeforeId(event.target.value); }} className={`${control} block w-36`} /></label><label className="space-y-1 text-xs text-surface-300">Comparison plan ID<input aria-label="Comparison plan ID" inputMode="numeric" value={afterId} onChange={event => { reset(); setAfterId(event.target.value); }} className={`${control} block w-36`} /></label><button type="submit" disabled={loading} className={control}>{loading ? 'Loading comparison...' : 'Load saved plan comparison'}</button></form>
      {loading && <p role="status" className="text-sm text-surface-300">Loading both saved plans...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {snapshot && <>
        <p className="break-words text-xs text-surface-400">Investigation #{snapshot.before.case_id} · Loaded {snapshot.loadedAt}. Baseline and comparison describe your chosen sides, not chronological versions. Refresh by loading again.</p>
        <div className="grid gap-3 sm:grid-cols-2">{[snapshot.before, snapshot.after].map((plan, index) => <div key={index} className="rounded border border-surface-700 p-3 text-xs text-surface-300"><Link className="text-primary-300" to={`/response-plans?plan=${plan.id}`}>{index ? 'Comparison' : 'Baseline'} plan #{plan.id}: open decision evidence</Link><p className="mt-2 break-words">Saved status: {plan.status} · Autonomy: {plan.autonomy_level} · {plan.actions.length} saved actions</p></div>)}</div>
        <p className="text-xs text-surface-300">Positions: {rows.filter(row => row.change === 'changed').length} changed · {rows.filter(row => row.change === 'added').length} added · {rows.filter(row => row.change === 'removed').length} removed · {rows.filter(row => row.change === 'unchanged').length} unchanged</p>
        <label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={changedOnly} onChange={event => { setChangedOnly(event.target.checked); setPage(1); }} />Show changed positions only</label>
        {!visible.length && <p className="text-sm text-surface-400">No {changedOnly ? 'changed ' : ''}action positions to show. Plan metadata may still differ.</p>}
        <div className="space-y-3">{visible.slice((page - 1) * 10, page * 10).map(row => <article key={row.position} className="space-y-2 rounded border border-surface-700 p-3"><h3 className="text-sm font-semibold text-surface-200">Stored action position {row.position}: {row.change}</h3><div className="grid gap-3 sm:grid-cols-2">{[row.before, row.after].map((value, index) => <div key={index} className="min-w-0"><h4 className="mb-1 text-xs text-surface-400">{index ? 'Comparison saved action' : 'Baseline saved action'}</h4><pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all rounded bg-surface-950 p-2 text-xs text-surface-300">{value ?? 'No action at this position'}</pre></div>)}</div></article>)}</div>
        <nav aria-label="Plan comparison action pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous comparison positions</button><span>Page {page} of {lastPage} · {visible.length} matching positions</span><button type="button" className={control} disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next comparison positions</button></nav>
        <details><summary className="cursor-pointer text-xs text-primary-300">Comparison scope</summary><p className="mt-2 text-xs text-surface-400">All saved action fields are compared as JSON, including any policy or result fields. Object key order is ignored; array order, missing fields, null and empty values remain distinct. Approval-request records are not compared. This does not approve, reject, execute, delete or change either plan.</p></details>
      </>}
    </>}
  </section>;
}
