import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { formatDuration } from '../utils/formatDuration';

interface RecordRow {
  id: number; title: string; severity: string; status: string; created_at: string | null;
  metric_at: string; duration_seconds: number | null; timing_reason: string;
}
interface Evidence {
  metric: string; days: number; query: string; offset: number; limit: number; total: number;
  window_start: string; generated_at: string; source_count: number; timing_count: number | null;
  excluded_timing_count: number | null; mean_seconds: number | null; records: RecordRow[];
}
const METRICS = { opened: 'Opened alerts', acknowledged: 'Acknowledged alerts', resolved: 'Resolved alerts' };
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function PostureAlertEvidence({ days }: { days: number }) {
  const [metric, setMetric] = useState<keyof typeof METRICS>('opened');
  const [query, setQuery] = useState(''), [offset, setOffset] = useState(0), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Evidence | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current; setResult(null); setError(''); setLoading(true);
    void apiClient.get<Evidence>('/reports/posture/alert-records', { params: { metric, days, query, offset, limit: 20 } }).then(({ data: value }) => {
      if (id !== request.current) return;
      if (!value || value.metric !== metric || value.days !== days || value.query !== query || value.offset !== offset || value.limit !== 20
        || !count(value.total) || !count(value.source_count) || value.total > value.source_count || !validDate(value.window_start) || !validDate(value.generated_at)
        || (value.mean_seconds !== null && (!Number.isFinite(value.mean_seconds) || value.mean_seconds < 0))
        || (metric === 'opened' ? value.timing_count !== null || value.excluded_timing_count !== null || value.mean_seconds !== null
          : !count(value.timing_count) || !count(value.excluded_timing_count) || value.timing_count + value.excluded_timing_count !== value.source_count || ((value.timing_count === 0) !== (value.mean_seconds === null)))
        || !Array.isArray(value.records) || value.records.length > 20 || value.records.length > value.total || new Set(value.records.map(row => row?.id)).size !== value.records.length
        || value.records.some(row => !row || !count(row.id) || row.id === 0 || typeof row.title !== 'string' || typeof row.status !== 'string' || typeof row.severity !== 'string' || typeof row.timing_reason !== 'string'
          || !validDate(row.metric_at) || Date.parse(row.metric_at.endsWith('Z') || /[+-]\d\d:\d\d$/.test(row.metric_at) ? row.metric_at : `${row.metric_at}Z`) < Date.parse(value.window_start) || (row.created_at !== null && !validDate(row.created_at)) || (row.duration_seconds !== null && (!Number.isFinite(row.duration_seconds) || row.duration_seconds < 0)))) throw new Error('Alert metric evidence did not match the requested scope. Reload before relying on it.');
      const last = Math.max(0, (Math.ceil(value.total / 20) - 1) * 20);
      if (offset > last) { setOffset(last); return; }
      setResult(value);
    }).catch(err => { if (id === request.current) setError(getApiErrorMessage(err, 'Alert metric evidence could not be loaded.')); })
      .finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [metric, days, query, offset, retry]);
  return <section aria-label="Posture alert metric evidence" className="oa-panel space-y-3 p-4">
    <h2 className="text-base font-semibold text-surface-100">Alert metric source records</h2>
    <p className="text-xs text-surface-400">Read-only current records owned by your account, not a frozen report or audit history. Opened uses creation time; acknowledged and resolved use their recorded response timestamp, even for alerts created before the window. A later status change does not remove a recorded timestamp. The summary above is not changed by these filters.</p>
    <div className="flex flex-wrap gap-3"><select aria-label="Posture alert metric" value={metric} onChange={event => { setMetric(event.target.value as keyof typeof METRICS); setOffset(0); }} className="min-h-10 rounded border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100">
      {Object.entries(METRICS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select><input type="search" aria-label="Find alert metric records" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} placeholder="Title, status, severity or ID" className="min-h-10 min-w-0 basis-full flex-1 rounded sm:basis-0 border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100" />
    {query && <button type="button" onClick={() => { setQuery(''); setOffset(0); }} className="text-xs text-primary-300">Clear metric search</button>}</div>
    {loading ? <p role="status" className="text-sm text-surface-400">Loading alert metric records...</p> : error ? <div role="alert" className="space-y-2 text-sm text-danger"><p>{error} No counts or response times are inferred.</p><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-3 py-2">Retry alert metric records</button></div> : result && <>
      <p role="status" className="text-xs text-surface-300">{result.total} matching records of {result.source_count} current {METRICS[metric].toLowerCase()}. Trailing {days} days from {result.window_start} UTC. Read at {result.generated_at}.</p>
      {metric !== 'opened' && <p className="text-sm text-surface-300">Current full-metric mean: {formatDuration(result.mean_seconds)}. {result.timing_count} usable timings; {result.excluded_timing_count} missing or negative timings excluded. Search and page do not change this mean. No usable timing means unknown, not zero.</p>}
      {result.records.length ? <ul className="space-y-3">{result.records.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
        <h3 className="break-words text-sm font-semibold text-surface-100">#{row.id}: {row.title}</h3><p className="text-xs text-surface-400">{row.severity} · {row.status}</p>
        <p className="break-words text-xs text-surface-300">Created: {row.created_at || 'not recorded'} · {metric}: {row.metric_at}</p>
        {metric !== 'opened' && <p className="text-xs text-surface-300">Elapsed: {formatDuration(row.duration_seconds)}. {row.timing_reason}</p>}
        <Link to={`/alerts?alert=${row.id}`} className="inline-block text-xs text-primary-300 underline">Open alert #{row.id}</Link>
      </li>)}</ul> : <p className="text-sm text-surface-400">No alert records match these filters. Other metrics or windows may contain records.</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs text-surface-300"><button type="button" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 20))} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Previous metric page</button><span>Page {offset / 20 + 1}</span><button type="button" disabled={offset + 20 >= result.total} onClick={() => setOffset(value => value + 20)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Next metric page</button></div>
    </>}
  </section>;
}
