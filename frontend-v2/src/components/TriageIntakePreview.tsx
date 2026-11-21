import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface RecordSample { id: number; label: string | null; severity: string | null; recorded_at: string | null }
interface Batch { eligible_count: number; batch_limit: number; batch_count: number; deferred_count: number; sample_limit: number; sample: RecordSample[] }
interface Preview { hours_back: number; retrieved_at: string; cutoff: string; alerts: Batch; events: Batch }
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
export function TriageIntakePreview() {
  const [hours, setHours] = useState(72), [open, setOpen] = useState(false), [retry, setRetry] = useState(0), [data, setData] = useState<Preview | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setData(null); setError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Preview>('/cases/triage-intake', { params: { hours_back: hours } }).then(({ data: value }) => {
      if (request !== reads.current) return;
      const validBatch = (batch: Batch, limit: number) => batch && batch.batch_limit === limit && batch.sample_limit === 10 && [batch.eligible_count, batch.batch_count, batch.deferred_count].every(n => Number.isSafeInteger(n) && n >= 0) && batch.batch_count === Math.min(batch.eligible_count, limit) && batch.deferred_count === Math.max(0, batch.eligible_count - limit) && Array.isArray(batch.sample) && batch.sample.length === Math.min(10, batch.eligible_count) && batch.sample.every(row => row && Number.isSafeInteger(row.id) && row.id > 0 && (row.label === null || typeof row.label === 'string') && (row.severity === null || typeof row.severity === 'string') && (row.recorded_at === null || typeof row.recorded_at === 'string')) && new Set(batch.sample.map(row => row.id)).size === batch.sample.length;
      if (!value || value.hours_back !== hours || typeof value.retrieved_at !== 'string' || typeof value.cutoff !== 'string' || !validBatch(value.alerts, 100) || !validBatch(value.events, 500)) throw new Error('Triage intake did not match the selected window or batch limits. Refresh before relying on it.');
      setData(value);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Triage intake could not be loaded.')); }).finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [hours, open, retry]);
  return <section aria-label="Read-only triage intake preview" className="oa-panel space-y-3 p-4 sm:p-6">
    <div className="flex flex-wrap items-center gap-2"><button type="button" className={button} aria-expanded={open} onClick={() => setOpen(value => !value)}>Preview automatic triage intake</button>{open && <label className="text-xs text-surface-300">Preview lookback<select className="ml-2 rounded border border-surface-600 bg-surface-950 p-2" value={hours} onChange={event => setHours(Number(event.target.value))}><option value={24}>24 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option></select></label>}</div>
    {open && <>
      <p className="text-xs text-surface-400">Read-only selection preview, no AI call or case creation. Includes owned recent evidence not linked to an owned investigation; events must be pending. This is triage intake, not a forecast of the full pipeline or a reserved batch. Counts can change before a run. The Run AI triage button uses 72 hours; the pipeline has its own separate lookback above.</p>
      {loading && <p role="status" className="text-sm text-surface-300">Loading current triage intake...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="button" className={button} disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh triage intake</button>
      {!loading && !error && data && <>
        <p className="break-all text-xs text-surface-400">Window begins {data.cutoff}. Read {data.retrieved_at}.</p>
        <div className="grid gap-4 lg:grid-cols-2">{([['alerts', data.alerts], ['events', data.events]] as const).map(([kind, batch]) => <div key={kind} className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
          <h3 className="text-sm font-semibold capitalize text-surface-100">{kind}: {batch.eligible_count} eligible</h3><p className="text-xs text-surface-300">Next batch: up to {batch.batch_count} of {batch.batch_limit} maximum · Beyond this batch: {batch.deferred_count}</p>
          <p className="text-xs text-surface-400">Newest timestamp, highest ID tie break. Showing {batch.sample.length} sampled record{batch.sample.length === 1 ? '' : 's'}, at most 10. Eligibility does not guarantee an incident or case will be created.</p>
          {!batch.eligible_count && <p className="text-xs text-surface-300">No eligible {kind} in this current window. This does not establish that all threats are investigated.</p>}
          <ol className="space-y-2">{batch.sample.map(row => <li key={row.id} className="min-w-0 space-y-1 border-t border-surface-700 pt-2 text-xs text-surface-300"><a className="break-words text-primary-300 underline" href={kind === 'alerts' ? `/app/alerts?alert=${row.id}` : `/app/events/${row.id}`}>#{row.id}: {row.label || 'Label not recorded'}</a><p className="break-all">{row.severity ?? 'Severity not recorded'} · {row.recorded_at ?? 'Time not recorded'}</p></li>)}</ol>
        </div>)}</div>
      </>}
    </>}
  </section>;
}
