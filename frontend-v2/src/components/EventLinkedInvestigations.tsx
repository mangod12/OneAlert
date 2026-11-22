import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
const statuses = ['all', 'open', 'investigating', 'resolved', 'closed', 'false_positive'] as const;
type Status = typeof statuses[number];
interface Row { id: number; title: string; severity: string | null; status: string | null; created_at: string; due_date: string | null; closed_at: string | null }
interface Result { event_id: number; status: Status; page: number; size: number; total: number; available_count: number; records: Row[]; retrieved_at: string; scope: string }
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function EventLinkedInvestigations({ eventId }: { eventId: number }) {
  const [draft, setDraft] = useState<Status>('all'), [applied, setApplied] = useState<Status | null>(null), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<Result | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [downloadError, setDownloadError] = useState(''); const request = useRef(0), dirty = applied !== null && applied !== draft;
  useEffect(() => {
    const read = ++request.current; setData(null); setError(''); setDownloadError('');
    if (applied === null) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Result>(`/events/${eventId}/linked-investigations`, { params: { status: applied, page, size: 10 } }).then(({ data: value }) => {
      if (read !== request.current) return;
      if (!value || value.event_id !== eventId || value.status !== applied || value.page !== page || value.size !== 10 || !count(value.total) || !count(value.available_count) || value.total > value.available_count || (applied === 'all' && value.total !== value.available_count) || !time(value.retrieved_at) || typeof value.scope !== 'string' || !Array.isArray(value.records) || value.records.length > 10 || new Set(value.records.map(row => row?.id)).size !== value.records.length || value.records.some(row => !row || !count(row.id) || row.id < 1 || typeof row.title !== 'string' || !time(row.created_at) || (row.status !== null && typeof row.status !== 'string') || (applied !== 'all' && row.status !== applied) || (row.severity !== null && typeof row.severity !== 'string') || (row.due_date !== null && (typeof row.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.due_date) || !time(row.due_date))) || (row.closed_at !== null && !time(row.closed_at)))) throw Error('Linked investigations did not match this event, exact status and complete page. Read again before relying on them.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw Error('Linked investigations returned an incomplete page. No absence is inferred.');
      setData(value);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Linked investigations unavailable.')); }).finally(() => { if (read === request.current) setLoading(false); });
    const invalidate = () => { request.current++; }; return invalidate;
  }, [eventId, applied, page, retry]);
  const download = () => {
    if (!data || dirty) return;
    setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_event_linked_investigation_page_v1', exported_at: new Date().toISOString(), ...data, download_scope: 'Only the currently loaded linked investigation page, not all matching cases. Contains potentially sensitive investigation titles; keep private. Downloaded copies have no application access controls. No new read, message or permission change.' }, null, 2) + '\n', `event-${eventId}-linked-investigations-page-${page}.json`, 'application/json'); }
    catch { setDownloadError('The loaded investigation page could not be downloaded. No links or records changed.'); }
  };
  return <section aria-label="Investigations linked to this event" className="oa-panel space-y-3 p-4">
    <h2 className="font-semibold text-surface-100">Investigations with a saved link to this event</h2><p className="text-xs text-surface-400">Explicitly read all owned investigations linked to event #{eventId}, including closed cases. Each investigation appears once even if old links are duplicated. Other people's private investigations and their counts are not disclosed. A saved link does not verify a common incident or compromise. No links or records are changed.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setApplied(draft); setPage(1); setRetry(value => value + 1); }}><label className="text-xs text-surface-300">Recorded investigation status<select aria-label="Linked investigation status" className={`${control} mt-1 block`} value={draft} onChange={event => setDraft(event.target.value as Status)}>{statuses.map(status => <option key={status} value={status}>{status === 'all' ? 'All statuses' : status.replaceAll('_', ' ')}</option>)}</select></label><button type="submit" className={control}>Read linked investigations</button><button type="button" className={control} onClick={() => { request.current++; setApplied(null); setData(null); setLoading(false); setError(''); setDownloadError(''); setPage(1); }}>Clear linked investigations</button></form>
    {dirty && <p role="status" className="text-xs text-warning">Status draft is not applied. Results still use the last submitted status; read or clear before paging or downloading.</p>}{loading && <p role="status" className="text-xs text-surface-300">Reading saved investigation links...</p>}{error && <p role="alert" className="text-xs text-danger">{error} No absence of investigations is inferred. Read again to retry.</p>}
    {!loading && !error && data && <>
      <p role="status" className="text-sm text-surface-200">{data.total} matching owned investigations · {data.available_count} owned linked investigations before status filter</p><p className="break-words text-xs text-surface-400">Event #{data.event_id} · Applied status: {data.status.replaceAll('_', ' ')} · Read {data.retrieved_at}. Counts and rows can change between reads and pages, not a frozen capture.</p>
      {!data.records.length && <p className="text-xs text-surface-400">No owned linked investigations match this status in this read. This does not establish that this event has never been investigated.</p>}
      <ol aria-label="Linked investigation records" className="space-y-2">{data.records.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h3 className="whitespace-pre-wrap break-words font-semibold text-surface-100">Case #{row.id}: {row.title}</h3><p className="break-words">Recorded status {row.status ?? 'not recorded'} · Severity {row.severity ?? 'not recorded'}</p><p className="break-words">Created {row.created_at} · Due {row.due_date ?? 'not recorded'} · Closed {row.closed_at ?? 'not recorded'}</p><div className="flex flex-wrap gap-3"><a className="inline-block text-primary-300 underline" href={`/app/cases/${row.id}`}>Open investigation #{row.id}</a><a className="inline-block text-primary-300 underline" href={`/app/cases/${row.id}/evidence?kind=event`}>Review linked events for investigation #{row.id}</a></div></li>)}</ol>
      <nav aria-label="Linked investigation pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" disabled={dirty || page === 1} className={control} onClick={() => setPage(page - 1)}>Previous linked investigations</button><span>Page {page} of {Math.max(1, Math.ceil(data.total / 10))}</span><button type="button" disabled={dirty || page * 10 >= data.total} className={control} onClick={() => setPage(page + 1)}>More linked investigations</button><button type="button" disabled={dirty} className={control} onClick={() => setRetry(value => value + 1)}>Refresh applied investigation links</button></nav>
      <button type="button" disabled={dirty} className={control} onClick={download}>Download this linked investigation page JSON</button><p className="text-xs text-surface-400">Only this loaded page is included, not all matching investigations. Titles may be sensitive. Keep private; downloaded copies have no application access controls. No new read or message.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
