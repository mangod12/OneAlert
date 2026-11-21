import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Evidence { id: number; label: string | null; severity: string | null; recorded_at: string | null; can_open_original: boolean }
type Relation = 'shared' | 'source_only' | 'other_only';
interface Comparison { relation: Relation; total: number; case_id: number; case_title: string; other_case_id: number; other_case_title: string; kind: 'alert' | 'event'; source_count: number; other_count: number; shared_count: number; source_only_count: number; other_only_count: number; page: number; size: number; records: Evidence[]; retrieved_at: string; scope: string }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function CaseEvidenceOverlap({ caseId }: { caseId: number }) {
  const [draft, setDraft] = useState(''), [other, setOther] = useState<number | null>(null), [kind, setKind] = useState<'alert' | 'event'>('alert'), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<Comparison | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [relation, setRelation] = useState<Relation>('shared');
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setData(null); setError('');
    if (other === null) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Comparison>(`/cases/${caseId}/evidence-overlap`, { params: { other_case_id: other, kind, relation, page, size: 10 } }).then(({ data: value }) => {
      if (request !== reads.current) return;
      const counts = value && [value.source_count, value.other_count, value.shared_count, value.source_only_count, value.other_only_count];
      if (!value || value.case_id !== caseId || value.other_case_id !== other || value.kind !== kind || value.relation !== relation || value.total !== (relation === 'shared' ? value.shared_count : relation === 'source_only' ? value.source_only_count : value.other_only_count) || value.page !== page || value.size !== 10 || !counts?.every(n => Number.isSafeInteger(n) && n >= 0) || value.source_only_count + value.shared_count !== value.source_count || value.other_only_count + value.shared_count !== value.other_count || !Array.isArray(value.records) || value.records.length > 10 || value.records.some(row => !row || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.can_open_original !== 'boolean' || (row.label !== null && typeof row.label !== 'string') || (row.severity !== null && typeof row.severity !== 'string') || (row.recorded_at !== null && typeof row.recorded_at !== 'string')) || new Set(value.records.map(row => row.id)).size !== value.records.length || typeof value.case_title !== 'string' || typeof value.other_case_title !== 'string') throw new Error('Evidence comparison did not match the selected investigations and page. Refresh before relying on it.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw new Error('Evidence comparison returned an incomplete page. Refresh before relying on it.');
      setData(value);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Investigation evidence comparison could not be loaded.')); }).finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [caseId, other, kind, relation, page, retry]);
  const compare = () => {
    if (!/^[1-9][0-9]*$/.test(draft.trim()) || !Number.isSafeInteger(Number(draft)) || Number(draft) > 2147483647 || Number(draft) === caseId) { reads.current += 1; setOther(null); setData(null); setLoading(false); setError('Enter a different positive investigation record ID.'); return; }
    setOther(Number(draft)); setPage(1); setRetry(value => value + 1);
  };
  return <section aria-label="Exact investigation evidence overlap" className="oa-panel space-y-4 p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-surface-100">Compare exact linked evidence</h2>
    <p className="text-xs text-surface-400">Compare investigation #{caseId} with another visible investigation by exact saved record IDs. Shared evidence does not prove a common incident. Counts exclude missing and wrong-owner links. This read-only comparison does not merge investigations, link evidence or run actions.</p>
    <form onSubmit={event => { event.preventDefault(); compare(); }} className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-surface-300">Other investigation ID<input className={`${control} mt-1 block w-full`} inputMode="numeric" value={draft} onChange={event => { reads.current += 1; setDraft(event.target.value); setOther(null); setData(null); setError(''); setLoading(false); }} /></label>
      <label className="text-xs text-surface-300">Evidence kind<select className={`${control} mt-1 block w-full`} value={kind} onChange={event => { reads.current += 1; setData(null); setKind(event.target.value as 'alert' | 'event'); setPage(1); }}><option value="alert">Alerts</option><option value="event">Events</option></select></label>
      <label className="text-xs text-surface-300">Record set<select className={`${control} mt-1 block w-full`} value={relation} onChange={event => { reads.current += 1; setData(null); setRelation(event.target.value as Relation); setPage(1); }}><option value="shared">Shared record IDs</option><option value="source_only">Only in this investigation</option><option value="other_only">Only in the other investigation</option></select></label>
      <button type="submit" className={control}>Compare linked record IDs</button>
    </form>
    {loading && <p role="status" className="text-sm text-surface-300">Comparing currently retrievable linked evidence...</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p>{other !== null && <button type="button" className={control} onClick={() => setRetry(value => value + 1)}>Retry evidence comparison</button>}</div>}
    {!loading && !error && data && <>
      <div className="space-y-2 text-sm text-surface-300"><p className="break-words">#{data.case_id}: {data.case_title}</p><p className="break-words"><a href={`/app/cases/${data.other_case_id}`} className="text-primary-300 underline">#{data.other_case_id}: {data.other_case_title}</a></p><p className="break-all text-xs text-surface-400">Read {data.retrieved_at}. Current linked records, not a frozen historical snapshot.</p></div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">{[[`${data.shared_count}`, 'Exact shared IDs'], [`${data.source_only_count}`, `Only in #${caseId}`], [`${data.other_only_count}`, `Only in #${data.other_case_id}`]].map(([count, label]) => <div key={label} className="rounded border border-surface-700 p-3"><dt className="text-xs text-surface-400">{label}</dt><dd className="text-xl font-semibold text-surface-100">{count}</dd></div>)}</dl>
      <p className="text-xs text-surface-400">Retrievable {data.kind}s: {data.source_count} in #{caseId}, {data.other_count} in #{data.other_case_id}. Selected details: {relation === 'shared' ? 'shared record IDs' : relation === 'source_only' ? `only in #${caseId}` : `only in #${data.other_case_id}`}. Missing from one retrievable set does not prove the underlying evidence was deleted. Similar text, IPs or techniques are not counted as shared IDs.</p>
      {!data.shared_count && <p className="text-sm text-surface-300">No exact shared {data.kind} IDs in the currently retrievable links. This does not establish that the investigations are unrelated.</p>}
      {!data.total && <p className="text-sm text-surface-300">No retrievable records in the selected set.</p>}
      <ol aria-label="Selected evidence set records" className="space-y-2">{data.records.map(row => <li key={row.id} className="min-w-0 space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300"><p className="break-words font-semibold text-surface-100">{data.kind} #{row.id}: {row.label || 'Label not recorded'}</p><p className="break-all">Severity: {row.severity ?? 'Not recorded'} · Recorded time: {row.recorded_at ?? 'Not recorded'}</p>{row.can_open_original ? <a className="inline-block text-primary-300 underline" href={data.kind === 'alert' ? `/app/alerts?alert=${row.id}` : `/app/events/${row.id}`}>Open original {data.kind} #{row.id}</a> : <p className="text-surface-400">Original record belongs to the investigation owner. No direct-access link is offered.</p>}</li>)}</ol>
      <nav aria-label="Selected evidence set pages" className="flex flex-wrap items-center gap-2"><button type="button" className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>{relation === 'shared' ? 'Previous shared evidence' : 'Previous selected evidence'}</button><span className="text-xs text-surface-400">Page {page} of {Math.max(1, Math.ceil(data.total / 10))}</span><button type="button" className={control} disabled={page * 10 >= data.total} onClick={() => setPage(page + 1)}>{relation === 'shared' ? 'More shared evidence' : 'More selected evidence'}</button><button type="button" className={control} onClick={() => setRetry(value => value + 1)}>Refresh evidence comparison</button></nav>
    </>}
  </section>;
}
