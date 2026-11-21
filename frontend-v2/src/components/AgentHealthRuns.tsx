import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { AgentRunInspector } from './AgentRunInspector';
export interface HealthRunScope { agent_type: string; run_status: string; from_date: string | null; before_date: string | null; report_count: number; report_read_at: string }
interface Row { id: number; agent_type: string; status: string; started_at: string | null; completed_at: string | null; model_used: string | null }
interface Result extends Omit<HealthRunScope, 'report_count' | 'report_read_at'> { page: number; size: number; total: number; retrieved_at: string; records: Row[]; scope: string }
const control = 'max-w-full min-h-10 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown) => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
export function AgentHealthRuns({ scope, onClose }: { scope: HealthRunScope; onClose: () => void }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [data, setData] = useState<Result | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [selected, setSelected] = useState<number | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const read = ++request.current; setData(null); setLoading(true); setError('');
    void apiClient.get<Result>('/cases/agents/recorded-health/runs', { params: { agent_type: scope.agent_type, run_status: scope.run_status, ...(scope.from_date ? { from_date: scope.from_date } : {}), ...(scope.before_date ? { before_date: scope.before_date } : {}), page, size: 10 } }).then(({ data: value }) => {
      if (read !== request.current) return;
      if (!value || value.agent_type !== scope.agent_type || value.run_status !== scope.run_status || value.from_date !== scope.from_date || value.before_date !== scope.before_date || value.page !== page || value.size !== 10 || !count(value.total) || typeof value.retrieved_at !== 'string' || !timestamp(value.retrieved_at) || typeof value.scope !== 'string' || !Array.isArray(value.records) || value.records.length > 10 || new Set(value.records.map(row => row?.id)).size !== value.records.length || value.records.some(row => !row || !count(row.id) || row.id < 1 || row.agent_type !== scope.agent_type || row.status !== scope.run_status || !timestamp(row.started_at) || !timestamp(row.completed_at) || (row.model_used !== null && typeof row.model_used !== 'string'))) throw Error('Run group did not match the exact requested recorded scope. Retry before relying on it.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw Error('Run group returned an incomplete page. Retry before relying on it.');
      setData(value);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Recorded run group unavailable. No absence of runs is inferred.')); }).finally(() => { if (read === request.current) setLoading(false); });
    const invalidate = () => { request.current++; }; return invalidate;
  }, [scope, page, retry]);
  return <section aria-label="Exact recorded health group runs" className="space-y-3 rounded border border-primary-600 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-words text-sm font-semibold text-primary-300">Run records: {scope.agent_type || '(empty agent type)'} · {scope.run_status || '(empty status)'}</h3><button type="button" className={control} onClick={onClose}>Close health run group</button></div>
    <p className="break-words text-xs text-surface-400">UTC start window: {scope.from_date ?? 'unbounded'} inclusive to {scope.before_date ?? 'unbounded'} exclusive. The health report had {scope.report_count} records at {scope.report_read_at}. This is a fresh current read, not those frozen records. Counts/statuses can change. A saved status is not proof of outcome or liveness. Nothing is rerun.</p>
    {loading && <p role="status" className="text-xs text-surface-300">Loading exact recorded run group...</p>}
    {error && <p role="alert" className="text-xs text-danger">{error} No absence of matching records is inferred.</p>}
    {!error && !loading && data && data.page === page && <>
      <p role="status" className="break-words text-sm text-surface-200">{data.total} current group records · Page {page} of {Math.max(1, Math.ceil(data.total / 10))} · Read {data.retrieved_at}</p>
      {data.total !== scope.report_count && <p className="text-xs text-warning">This current count differs from the earlier health report. Neither is a frozen snapshot; refresh the health report if you need its current aggregate.</p>}
      {!data.records.length && <p className="text-xs text-surface-400">No run records match this exact group in this current read. This does not prove no activity occurred.</p>}
      <ol aria-label="Exact health group run records" className="space-y-2">{data.records.map(row => <li key={row.id} className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h4 className="text-sm font-semibold text-surface-100">Recorded run #{row.id}</h4><p className="break-words">Started {row.started_at ?? 'not recorded'} · Completed {row.completed_at ?? 'not recorded'} · Model {row.model_used === null ? 'not recorded' : row.model_used === '' ? '(empty recorded model)' : row.model_used}</p><button type="button" className={control} onClick={() => setSelected(row.id)}>Inspect group run #{row.id}</button></li>)}</ol>
    </>}
    <nav aria-label="Exact health group run pages" className="flex flex-wrap gap-2"><button type="button" disabled={loading || page === 1} className={control} onClick={() => setPage(page - 1)}>Previous health run records</button><button type="button" disabled={loading || !data || page * 10 >= data.total} className={control} onClick={() => setPage(page + 1)}>More health run records</button><button type="button" disabled={loading} className={control} onClick={() => setRetry(value => value + 1)}>Refresh exact health run group</button></nav>
    {selected !== null && <AgentRunInspector key={selected} runId={selected} onClose={() => setSelected(null)} />}
  </section>;
}
