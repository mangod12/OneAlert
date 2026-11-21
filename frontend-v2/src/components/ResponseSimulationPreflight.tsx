import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Row { source_position: number; action_type: string | null; target: string | null; priority: number | null; priority_defaulted: boolean; shape_valid: boolean; handler_available: boolean; recorded_policy_approved: boolean | null; simulation_order: number | null }
interface Preflight { plan_id: number; case_id: number; status: string; execution_mode: string; retrieved_at: string; action_count: number; supported_count: number; unsupported_count: number; invalid_count: number; shape_valid: boolean; order_available: boolean; records: Row[] }
const button = 'max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
export function ResponseSimulationPreflight({ planId }: { planId: number }) {
  const [open, setOpen] = useState(false), [retry, setRetry] = useState(0), [page, setPage] = useState(1), [loading, setLoading] = useState(false), [error, setError] = useState(''), [data, setData] = useState<Preflight | null>(null);
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setData(null); setError(''); setPage(1);
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Preflight>(`/response-plans/${planId}/simulation-preflight`).then(({ data: value }) => {
      if (request !== reads.current) return;
      const counts = value && [value.action_count, value.supported_count, value.unsupported_count, value.invalid_count];
      const validRows = Array.isArray(value?.records) && value.records.length <= 5000 && value.records.every((row, index) => row && row.source_position === index + 1 && typeof row.shape_valid === 'boolean' && typeof row.handler_available === 'boolean' && typeof row.priority_defaulted === 'boolean' && (row.action_type === null || typeof row.action_type === 'string') && (row.target === null || typeof row.target === 'string') && (row.priority === null || (typeof row.priority === 'number' && Number.isFinite(row.priority) && Math.abs(row.priority) <= Number.MAX_SAFE_INTEGER)) && (row.recorded_policy_approved === null || typeof row.recorded_policy_approved === 'boolean'));
      const validOrder = validRows && (value.order_available ? value.records.every(row => row.shape_valid && Number.isSafeInteger(row.simulation_order) && row.simulation_order! > 0 && row.simulation_order! <= value.records.length) && new Set(value.records.map(row => row.simulation_order)).size === value.records.length : value.records.every(row => row.simulation_order === null));
      if (!value || value.plan_id !== planId || value.execution_mode !== 'simulated' || typeof value.status !== 'string' || typeof value.retrieved_at !== 'string' || typeof value.order_available !== 'boolean' || !validRows || !validOrder || !counts?.every(n => Number.isSafeInteger(n) && n >= 0) || value.action_count !== value.records.length || value.supported_count !== value.records.filter(row => row.handler_available).length || value.unsupported_count !== value.records.filter(row => !row.handler_available).length || value.invalid_count !== value.records.filter(row => !row.shape_valid).length) throw new Error('Simulation preflight did not match the requested saved plan. Refresh before relying on it.');
      setData(value);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Simulation preflight could not be loaded.')); }).finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [planId, open, retry]);
  return <section aria-label="Read-only simulation preflight" className="space-y-3 rounded border border-surface-700 p-3">
    <button type="button" className={button} aria-expanded={open} onClick={() => setOpen(value => !value)}>Inspect simulation handler readiness</button>
    {open && <>
      <p className="text-xs text-surface-400">Read-only check of this saved plan and current local handlers. Supported means a simulation handler exists, not a configured live integration. No handler, network request, approval or execution is performed. Target ownership, safety, reachability and rollback readiness are not validated. Recorded policy flags are not a fresh safety check or permission.</p>
      {loading && <p role="status" className="text-xs text-surface-300">Loading saved-plan simulation preflight...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="button" disabled={loading} className={button} onClick={() => setRetry(value => value + 1)}>Refresh simulation preflight</button>
      {!loading && !error && data && <>
        <p className="break-words text-xs text-surface-400">Plan #{data.plan_id} · Saved status {data.status} · Read {data.retrieved_at}</p>
        <p className="text-sm text-surface-200">{data.action_count} saved actions · {data.supported_count} recognized handlers · {data.unsupported_count} unsupported · {data.invalid_count} invalid action shapes</p>
        {!data.action_count && <p className="text-xs text-warning">No usable action list. This is not a runnable-plan confirmation.</p>}
        {!data.order_available && data.action_count > 0 && <p className="text-xs text-warning">Simulation order unavailable. At least one action lacks a usable type, target or finite numeric priority. No order is guessed.</p>}
        <ol className="space-y-2">{data.records.slice((page - 1) * 10, page * 10).map(row => <li key={row.source_position} className="min-w-0 space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300">
          <p className="break-all font-semibold">Saved position {row.source_position}: {row.action_type ?? 'Type unavailable'}</p><p className="break-all">Target: {row.target ?? 'Target unavailable'}</p>
          <p>{row.handler_available ? 'Local simulation handler recognized' : 'Unsupported local handler'} · {row.shape_valid ? 'Action shape usable' : 'Invalid action shape'}</p>
          <p>Priority: {row.priority ?? 'Invalid'}{row.priority_defaulted ? ' (default 99)' : ''} · Simulation order: {row.simulation_order ?? 'Unavailable'}</p>
          <p>Recorded policy flag: {row.recorded_policy_approved === true ? 'Approved' : row.recorded_policy_approved === false ? 'Not approved' : 'Not recorded'}</p>
        </li>)}</ol>
        {data.records.length > 10 && <nav aria-label="Simulation preflight action pages" className="flex flex-wrap gap-2"><button type="button" className={button} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous preflight actions</button><span className="text-xs text-surface-400">Page {page} of {Math.ceil(data.records.length / 10)}</span><button type="button" className={button} disabled={page * 10 >= data.records.length} onClick={() => setPage(page + 1)}>More preflight actions</button></nav>}
      </>}
    </>}
  </section>;
}
