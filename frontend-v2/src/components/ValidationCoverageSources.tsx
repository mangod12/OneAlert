import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Source { step_id: number; step_number: number; run_id: number; run_name: string; run_status: string; run_mode: string; test_name: string; step_status: string; simulated: boolean | null; actual_result: string | null; executed_at: string | null; control_result_count: number; recorded_detected: number; recorded_not_detected: number; unknown_outcomes: number; }
interface Snapshot { technique_id: string; technique_name: string; execution: string; run_status: string; page: number; size: number; total: number; retrieved_at: string; records: Source[]; }
const control = 'max-w-full rounded border border-surface-600 px-3 py-2 text-left text-xs text-surface-200 disabled:opacity-40';
export function ValidationCoverageSources(props: { techniqueId: string; techniqueName: string; execution: string; runStatus: string }) {
  return <Sources key={JSON.stringify(props)} {...props} />;
}
function Sources({ techniqueId, techniqueName, execution, runStatus }: { techniqueId: string; techniqueName: string; execution: string; runStatus: string }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setSnapshot(null); setError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Snapshot>('/validation/coverage-evidence/steps', { params: { technique_id: techniqueId, technique_name: techniqueName, execution, run_status: runStatus, page, size: 10 } }).then(response => {
      if (request !== requestId.current) return;
      const value = response.data;
      if (value.technique_id !== techniqueId || value.technique_name !== techniqueName || value.execution !== execution || value.run_status !== runStatus || value.page !== page || value.size !== 10 || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.records) || value.records.some(row => !Number.isSafeInteger(row.run_id) || row.run_id < 1 || !Number.isSafeInteger(row.step_id) || row.step_id < 1)) throw Error('Source records did not match the selected coverage group. Try again.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      setSnapshot(value);
    }).catch(err => { if (request === requestId.current) setError(getApiErrorMessage(err, 'Coverage source steps could not be loaded.')); }).finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [open, techniqueId, techniqueName, execution, runStatus, page, retry]);
  return <section aria-label={`Source steps for ${techniqueId}: ${techniqueName}`} className="space-y-3 border-t border-surface-700 pt-3">
    <button type="button" className={control} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide source steps' : `Review source steps for ${techniqueId}: ${techniqueName}`}</button>
    {open && <>
      <p className="text-xs text-surface-400">Exact recorded technique ID and name, under the current execution flag and run status. One row per saved step, including steps without controls. Counts are recorded control outcomes, not proof that live controls fired. These are separate current reads, not a frozen coverage snapshot.</p>
      {loading && <p role="status">Loading source steps...</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-danger">{error}</p><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Retry source steps</button></div>}
      {!loading && !error && snapshot && <>
        <p className="break-words text-surface-400">{snapshot.total} matching saved steps · Page {page} of {Math.max(1, Math.ceil(snapshot.total / 10))} · Received {snapshot.retrieved_at}</p>
        {!snapshot.records.length && <p>No saved steps currently match this group. Records may have changed since the group was loaded. This does not establish zero detections.</p>}
        <ol className="space-y-3">{snapshot.records.map(row => <li key={row.step_id} className="min-w-0 space-y-2 rounded border border-surface-600 p-3">
          <h4 className="break-words font-semibold [overflow-wrap:anywhere]">Step #{row.step_id}, position {row.step_number}: {row.test_name}</h4>
          <Link className="break-words text-primary-300 [overflow-wrap:anywhere]" to={`/validation?run=${row.run_id}`}>Open saved run #{row.run_id}: {row.run_name}</Link>
          <p>Run status: {row.run_status} · Mode: {row.run_mode} · Step status: {row.step_status}</p>
          <p>Execution flag: {row.simulated === null ? 'Not recorded' : row.simulated ? 'Simulated' : 'Non-simulated'} · Step result: {row.actual_result ?? 'Not recorded'}</p>
          <p>{row.control_result_count} control results: {row.recorded_detected} detected, {row.recorded_not_detected} not detected, {row.unknown_outcomes} unknown outcomes.</p>
          <p>Executed at: {row.executed_at ?? 'Not recorded'}</p>
          {row.control_result_count === 0 && <p className="text-warning">No control results saved for this step.</p>}
        </li>)}</ol>
        <p className="text-surface-400">Run links read the complete current saved results by ID. They do not execute tests, contact recipients or grant access.</p>
        <nav aria-label="Coverage source step pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous source steps</button><button type="button" className={control} disabled={page * 10 >= snapshot.total} onClick={() => setPage(page + 1)}>Next source steps</button><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Refresh source steps</button></nav>
      </>}
    </>}
  </section>;
}
