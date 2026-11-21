import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { SlaEvidenceExport } from './SlaEvidenceExport';
import { getApiErrorMessage } from '../api/errors';

interface SlaRecord {
  id: number;
  title: string;
  status: string;
  severity: string;
  due_date: string;
  completed_on: string | null;
  outcome: 'met' | 'breached' | 'unknown';
  reason: string;
}
interface EvidencePage {
  kind: string;
  days: number;
  window_start: string;
  window_end: string;
  generated_at: string;
  total: number;
  offset: number;
  limit: number;
  outcome: string;
  query: string;
  records: SlaRecord[];
}

export function SlaEvidenceExplorer({ kind, days }: { kind: 'alerts' | 'cases'; days: number }) {
  const [outcome, setOutcome] = useState('all');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<EvidencePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setResult(null);
    setError('');
    void apiClient.get<EvidencePage>('/reports/sla/records', { params: { kind, days, outcome, query, offset, limit: 20 } })
      .then(response => {
        if (id !== request.current) return;
        const value = response.data;
        const validDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
        if (!value || value.kind !== kind || value.days !== days || value.outcome !== outcome || value.query !== query || value.offset !== offset || value.limit !== 20
          || !Number.isSafeInteger(value.total) || value.total < 0 || !validDate(value.window_start) || !validDate(value.window_end)
          || Date.parse(value.window_end) - Date.parse(value.window_start) !== (days - 1) * 86400000 || typeof value.generated_at !== 'string' || !Number.isFinite(Date.parse(value.generated_at))
          || !Array.isArray(value.records) || value.records.length > 20 || value.records.length > value.total || new Set(value.records.map(r => r?.id)).size !== value.records.length
          || value.records.some(r => !r || !Number.isSafeInteger(r.id) || r.id < 1 || typeof r.title !== 'string' || typeof r.status !== 'string' || typeof r.severity !== 'string' || typeof r.reason !== 'string'
            || !validDate(r.due_date) || r.due_date < value.window_start || r.due_date > value.window_end || (r.completed_on !== null && !validDate(r.completed_on))
            || !['met', 'breached', 'unknown'].includes(r.outcome) || (outcome !== 'all' && r.outcome !== outcome))) throw new Error('SLA evidence did not match the requested record scope. Retry before relying on it.');
        const lastOffset = Math.max(0, (Math.ceil(value.total / 20) - 1) * 20);
        if (offset > lastOffset) { setOffset(lastOffset); return; }
        setResult(value);
      })
      .catch(err => { if (id === request.current) setError(getApiErrorMessage(err, 'SLA evidence could not be loaded.')); })
      .finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [kind, days, outcome, query, offset, retry]);
  const noun = kind === 'cases' ? 'investigation' : 'alert';
  return <section aria-label={`${noun} SLA evidence`} className="space-y-3 border-t border-surface-700 p-4">
    <h3 className="text-sm font-semibold text-surface-100">Recorded {noun} SLA evidence</h3>
    <p className="text-xs text-surface-400">Read-only records owned by your account, selected by due date. This is a new snapshot, not an audit history. Counts may change after the summary was generated.</p>
    <label className="block text-xs text-surface-300" htmlFor={`sla-search-${kind}`}>Find SLA records by title, status or ID</label>
    <input id={`sla-search-${kind}`} type="search" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} maxLength={200}
      className="min-h-10 w-full min-w-0 rounded border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100" />
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="SLA outcome" value={outcome} onChange={event => { setOutcome(event.target.value); setOffset(0); }} className="min-h-10 rounded border border-surface-600 bg-surface-950 px-2 text-sm text-surface-100">
        <option value="all">All outcomes</option><option value="met">Met</option><option value="breached">Breached</option><option value="unknown">Unknown completion timing</option>
      </select>
      {(query || outcome !== 'all') && <button type="button" onClick={() => { setQuery(''); setOutcome('all'); setOffset(0); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Clear evidence filters</button>}
    </div>
    <SlaEvidenceExport key={`${kind}:${days}:${outcome}:${query}`} kind={kind} days={days} outcome={outcome} query={query} />
    {loading ? <p role="status" className="text-sm text-surface-400">Loading current SLA evidence...</p> : error ? <div role="alert" className="space-y-2 text-sm text-danger"><p>{error} No records or outcomes are inferred.</p><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-surface-200">Retry SLA evidence</button></div> : result && <>
      <p role="status" className="text-xs text-surface-300">{result.total} matching records · Due {result.window_start} through {result.window_end} (UTC dates). Snapshot: {result.generated_at}. Filters do not change the summary above.</p>
      {result.records.length ? <ul aria-label="SLA evidence records" className="space-y-3">{result.records.map(record => <li key={record.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-surface-800 px-2 py-1 text-surface-200">{record.outcome}</span><span className="text-surface-400">{record.severity} · {record.status}</span></div>
        <h4 className="break-words text-sm font-medium text-surface-100">#{record.id}: {record.title}</h4>
        <p className="text-xs text-surface-300">Due {record.due_date} · Recorded completion: {record.completed_on || 'not recorded'}</p>
        <p className="text-xs text-surface-400">{record.reason}</p>
        <Link to={kind === 'cases' ? `/cases/${record.id}` : `/alerts?alert=${record.id}`} className="inline-block text-xs text-primary-300 underline">Open {noun} #{record.id}</Link>
      </li>)}</ul> : <p className="text-sm text-surface-400">No records match this page and these filters. This does not mean there are no SLA records in other windows.</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs text-surface-300">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Previous evidence page</button>
        <span>Page {Math.floor(offset / 20) + 1} · Up to 20 records per page</span>
        <button type="button" disabled={offset + 20 >= result.total} onClick={() => setOffset(value => value + 20)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Next evidence page</button>
      </div>
    </>}
  </section>;
}
