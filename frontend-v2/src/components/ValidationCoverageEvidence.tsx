import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Technique { technique_id: string; technique_name: string; run_count: number; step_count: number; simulated_steps: number; non_simulated_steps: number; unknown_execution_steps: number; control_result_count: number; recorded_detected: number; recorded_not_detected: number; unknown_outcomes: number; recorded_detection_percentage: number | null; }
interface Snapshot { schema_version: number; scope: string; execution: string; run_status: string; page: number; size: number; total: number; retrieved_at: string; techniques: Technique[]; }
const control = 'rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function ValidationCoverageEvidence() {
  const [open, setOpen] = useState(false), [execution, setExecution] = useState('all'), [runStatus, setRunStatus] = useState('completed');
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setSnapshot(null); setError(''); setDownloadError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Snapshot>('/validation/coverage-evidence', { params: { execution, run_status: runStatus, page, size: 20 } }).then(response => {
      if (request !== requestId.current) return;
      const value = response.data;
      if (value.execution !== execution || value.run_status !== runStatus || value.page !== page || value.size !== 20 || !Array.isArray(value.techniques)) throw new Error('Coverage evidence did not match the requested scope. Try again.');
      const last = Math.max(1, Math.ceil(value.total / 20)); if (page > last) { setPage(last); return; }
      setSnapshot(value);
    }).catch(err => { if (request === requestId.current) setError(getApiErrorMessage(err, 'Recorded coverage evidence could not be loaded.')); })
      .finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [open, execution, runStatus, page, retry]);
  const download = () => {
    if (!snapshot || loading || error) return;
    setDownloadError('');
    try {
      const blob = new Blob([JSON.stringify({ evidence_type: 'recorded_validation_coverage_page', exported_at: new Date().toISOString(), export_scope: 'Only this loaded page of technique groups under the recorded filters, not all groups or verified live detection coverage.', ...snapshot }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `validation-coverage-evidence-page-${snapshot.page}.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('Coverage evidence could not be downloaded. The loaded groups remain visible.'); }
  };
  return <section className="oa-panel space-y-4 p-4 sm:p-6" aria-label="Recorded coverage evidence explorer">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Recorded coverage evidence</h2><button type="button" className={control} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide coverage evidence' : 'Review coverage evidence'}</button></div>
    <p className="text-xs text-surface-400">Separate simulated, flagged non-simulated and unknown execution evidence. Flags are saved metadata, not independent verification of live detection. Counts describe stored control results, steps and runs, not unique real-world tests. Steps with no control results remain visible.</p>
    {open && <>
      <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-surface-300">Recorded execution<select aria-label="Coverage evidence execution filter" value={execution} onChange={event => { setExecution(event.target.value); setPage(1); }} className={`${control} mt-1 block w-full`}><option value="all">All execution flags</option><option value="simulated">Simulated flag</option><option value="non_simulated">Non-simulated flag</option><option value="unknown">Execution flag not recorded</option></select></label><label className="text-xs text-surface-300">Run status<select aria-label="Coverage evidence run status" value={runStatus} onChange={event => { setRunStatus(event.target.value); setPage(1); }} className={`${control} mt-1 block w-full`}><option value="all">All recorded run statuses</option>{['completed','failed','running','pending','cancelled'].map(status => <option key={status} value={status}>{status}</option>)}</select></label><button type="button" disabled={loading} className={control} onClick={() => setRetry(retry + 1)}>Refresh coverage evidence</button></div>
      <p className="text-xs text-surface-400">Only the selected run status and execution flag are included. Percentages use recorded detected and not-detected control results only. Missing outcomes are excluded from the denominator, not counted as failures or successes.</p>
      {loading && <p role="status" className="text-sm text-surface-300">Loading recorded coverage evidence...</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Retry coverage evidence</button></div>}
      {!loading && !error && snapshot && <>
        <p className="break-words text-xs text-surface-400">{snapshot.total} technique groups match. Page {snapshot.page} of {Math.max(1, Math.ceil(snapshot.total / snapshot.size))}. Grouping uses exact technique ID and recorded name. Received {snapshot.retrieved_at}.</p>
        <button type="button" className={control} disabled={!snapshot.techniques.length} onClick={download}>Download loaded coverage page JSON</button>
        {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
        {!snapshot.techniques.length && <p className="text-sm text-surface-300">No recorded technique groups match this scope. This is not evidence of zero detections or complete coverage.</p>}
        <ol className="space-y-3">{snapshot.techniques.map(row => <li key={JSON.stringify([row.technique_id, row.technique_name])} className="min-w-0 space-y-2 rounded-lg border border-surface-700 p-3 text-xs text-surface-300">
          <h3 className="break-words text-sm font-semibold text-surface-100 [overflow-wrap:anywhere]">{row.technique_id} · {row.technique_name}</h3>
          <p>{row.run_count} recorded runs · {row.step_count} steps · {row.control_result_count} control results</p>
          <p>Steps by execution flag: {row.simulated_steps} simulated, {row.non_simulated_steps} non-simulated, {row.unknown_execution_steps} unknown</p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div><dt className="text-surface-400">Recorded detected</dt><dd>{row.recorded_detected}</dd></div><div><dt className="text-surface-400">Recorded not detected</dt><dd>{row.recorded_not_detected}</dd></div><div><dt className="text-surface-400">Missing outcome</dt><dd>{row.unknown_outcomes}</dd></div><div><dt className="text-surface-400">Detected among known outcomes</dt><dd>{row.recorded_detection_percentage === null ? 'Unavailable, no known outcomes' : `${row.recorded_detection_percentage}%`}</dd></div></dl>
          {row.control_result_count === 0 && <p className="text-warning">No control results were recorded for these steps.</p>}
        </li>)}</ol>
        <nav aria-label="Coverage evidence pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous coverage groups</button><button type="button" className={control} disabled={page * snapshot.size >= snapshot.total} onClick={() => setPage(page + 1)}>Next coverage groups</button></nav>
      </>}
    </>}
  </section>;
}
