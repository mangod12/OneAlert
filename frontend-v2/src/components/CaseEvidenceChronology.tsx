import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';

type Kind = 'all' | 'alert' | 'event';
interface Row { kind: 'alert' | 'event'; id: number; label: string | null; severity: string | null; recorded_at: string | null; can_open_original: boolean }
interface Snapshot { case_id: number; kind: Kind; severity: string; order: string; page: number; size: number; total: number; counts: Record<'alert' | 'event', { available: number; unavailable: number }>; records: Row[]; retrieved_at: string }
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function CaseEvidenceChronology({ caseId }: { caseId: number }) {
  const [opened, setOpened] = useState(false), [kind, setKind] = useState<Kind>('all'), [severity, setSeverity] = useState('all'), [order, setOrder] = useState('oldest');
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState(''), [data, setData] = useState<Snapshot | null>(null);
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setData(null); setError('');
    if (!opened) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Snapshot>(`/cases/${caseId}/evidence-chronology`, { params: { kind, severity, order, page, size: 10 } }).then(({ data: value }) => {
      if (request !== reads.current) return;
      if (!value || value.case_id !== caseId || value.kind !== kind || value.severity !== severity || value.order !== order || value.page !== page || value.size !== 10 || !count(value.total) || !['alert', 'event'].every(key => count(value.counts?.[key as 'alert' | 'event']?.available) && count(value.counts?.[key as 'alert' | 'event']?.unavailable)) || typeof value.retrieved_at !== 'string' || !Number.isFinite(Date.parse(value.retrieved_at)) || !Array.isArray(value.records) || value.records.some(row => !row || !['alert', 'event'].includes(row.kind) || (kind !== 'all' && row.kind !== kind) || !count(row.id) || row.id === 0 || typeof row.can_open_original !== 'boolean' || (row.label !== null && typeof row.label !== 'string') || (row.severity !== null && typeof row.severity !== 'string') || (severity !== 'all' && row.severity !== severity) || (row.recorded_at !== null && (typeof row.recorded_at !== 'string' || !Number.isFinite(Date.parse(row.recorded_at))))) || new Set(value.records.map(row => `${row.kind}-${row.id}`)).size !== value.records.length) throw new Error('Evidence chronology did not match the selected scope. Refresh before relying on it.');
      const available = kind === 'all' ? value.counts.alert.available + value.counts.event.available : value.counts[kind].available;
      if (value.total > available || (severity === 'all' && value.total !== available)) throw new Error('Evidence chronology counts are inconsistent. Refresh before relying on it.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw new Error('Evidence chronology returned an incomplete page. Refresh before relying on it.');
      setData(value);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Evidence chronology could not be loaded.')); }).finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [caseId, opened, kind, severity, order, page, retry]);
  const change = (action: () => void) => { reads.current += 1; setData(null); setError(''); setPage(1); action(); };
  return <section aria-label="Linked evidence chronology" className="oa-panel space-y-4 p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-surface-100">Linked evidence chronology</h2>
    <p className="text-xs text-surface-400">Read alerts and events together in saved-time order. Alert time is record creation, event time is the saved telemetry timestamp. These clocks do not establish attack sequence, causation or when evidence was linked. Notes and case activity are in the separate investigation timeline.</p>
    {!opened ? <button className={control} onClick={() => setOpened(true)}>Load evidence chronology</button> : <>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-surface-300">Chronology evidence<select className={`${control} mt-1 block w-full`} value={kind} onChange={event => change(() => setKind(event.target.value as Kind))}><option value="all">Alerts and events</option><option value="alert">Alerts only</option><option value="event">Events only</option></select></label>
        <label className="text-xs text-surface-300">Chronology severity<select className={`${control} mt-1 block w-full`} value={severity} onChange={event => change(() => setSeverity(event.target.value))}>{['all', 'info', 'low', 'medium', 'high', 'critical'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-xs text-surface-300">Time order<select className={`${control} mt-1 block w-full`} value={order} onChange={event => change(() => setOrder(event.target.value))}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
        <button className={`${control} self-end`} onClick={() => setRetry(value => value + 1)}>Refresh chronology</button>
      </div>
      {loading && <p role="status" className="text-sm text-surface-300">Loading linked evidence chronology...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loading && !error && data && <>
        <p className="text-sm text-surface-200">{data.total} matching linked records</p>
        <p className="break-all text-xs text-surface-400">Read {data.retrieved_at}. Current records, not a frozen historical snapshot. Missing timestamps are placed last in either order.</p>
        <p className="text-xs text-surface-400">Before filters: {data.counts.alert.available} alerts and {data.counts.event.available} events retrievable. {data.counts.alert.unavailable + data.counts.event.unavailable} unavailable linked references excluded (missing or outside the investigation owner's evidence). Duplicate links are counted once per record.</p>
        {data.total === 0 && <p className="text-sm text-surface-300">No retrievable linked records match these filters. This is not proof that no activity occurred.</p>}
        <ol className="space-y-2">{data.records.map(row => <li key={`${row.kind}-${row.id}`} className="min-w-0 space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300">
          <p className="break-words font-semibold text-surface-100">{row.kind} #{row.id}: {row.label || 'Label not recorded'}</p>
          <p className="break-all">{row.kind === 'alert' ? 'Alert created' : 'Event timestamp'}: {row.recorded_at ?? 'Not recorded'} · Severity: {row.severity ?? 'Not recorded'}</p>
          {row.can_open_original ? <a className="inline-block text-primary-300 underline" href={row.kind === 'alert' ? `/app/alerts?alert=${row.id}` : `/app/events/${row.id}`}>Open original {row.kind} #{row.id}</a> : <p className="text-surface-400">Original record belongs to the investigation owner. No direct-access link is offered.</p>}
        </li>)}</ol>
        <nav aria-label="Evidence chronology pages" className="flex flex-wrap items-center gap-2"><button className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous chronology page</button><span className="text-xs text-surface-400">Page {page} of {Math.max(1, Math.ceil(data.total / 10))}</span><button className={control} disabled={page * 10 >= data.total} onClick={() => setPage(page + 1)}>Next chronology page</button></nav>
      </>}
    </>}
  </section>;
}
