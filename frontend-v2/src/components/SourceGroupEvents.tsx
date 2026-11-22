import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
export interface SourceGroupSelection { group: 'severity' | 'event_type' | 'source_type' | 'processed'; value: string | null; profileCount: number; profileReadAt: string }
interface Row { id: number; timestamp: string; event_type: string; severity: string | null; signature: string | null; source_type: string | null; processed: string | null; source_ip: string | null; dest_ip: string | null; hostname: string | null }
interface Result { source_id: number; group: SourceGroupSelection['group']; value: string | null; missing: boolean; page: number; size: number; total: number; records: Row[]; retrieved_at: string; scope: string }
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const display = (value: string | null) => value === null ? '(not recorded)' : value === '' ? '(empty text)' : value;
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function SourceGroupEvents({ sourceId, selection, onClose }: { sourceId: number; selection: SourceGroupSelection; onClose: () => void }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [data, setData] = useState<Result | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [downloadError, setDownloadError] = useState(''); const request = useRef(0);
  useEffect(() => {
    const read = ++request.current; setData(null); setError(''); setDownloadError(''); setLoading(true);
    void apiClient.get<Result>(`/events/sources/${sourceId}/group-events`, { params: { group: selection.group, ...(selection.value === null ? { missing: true } : { value: selection.value }), page, size: 10 } }).then(({ data: value }) => {
      if (read !== request.current) return;
      if (!value || value.source_id !== sourceId || value.group !== selection.group || value.value !== selection.value || value.missing !== (selection.value === null) || value.page !== page || value.size !== 10 || !count(value.total) || !time(value.retrieved_at) || typeof value.scope !== 'string' || !Array.isArray(value.records) || value.records.length > 10 || new Set(value.records.map(row => row?.id)).size !== value.records.length || value.records.some(row => !row || !count(row.id) || row.id < 1 || !time(row.timestamp) || typeof row.event_type !== 'string' || row[selection.group] !== selection.value || (['severity', 'signature', 'source_type', 'processed', 'source_ip', 'dest_ip', 'hostname'] as const).some(field => row[field] !== null && typeof row[field] !== 'string'))) throw Error('Source group events did not match the exact source, label and complete page. Read again before relying on them.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw Error('Source group events returned an incomplete page. No absence is inferred.');
      setData(value);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Source group events unavailable.')); }).finally(() => { if (read === request.current) setLoading(false); });
    const invalidate = () => { request.current++; }; return invalidate;
  }, [sourceId, selection.group, selection.value, page, retry]);
  const download = () => {
    if (!data) return; setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_source_group_event_page_v1', exported_at: new Date().toISOString(), ...data, prior_profile_count: selection.profileCount, prior_profile_read_at: selection.profileReadAt, download_scope: 'Only this loaded exact source/label event page, not all matching events. Profile count is a prior separate read. Potentially sensitive recorded addresses and host names; downloaded copies have no application access controls. No raw payload, extra read, message or permission change.' }, null, 2) + '\n', `source-${sourceId}-${selection.group}-events-page-${page}.json`, 'application/json'); }
    catch { setDownloadError('The loaded group event page could not be downloaded. No records changed.'); }
  };
  return <section aria-label="Exact source label event records" className="space-y-3 rounded border border-primary-700 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 whitespace-pre-wrap break-all text-sm font-semibold text-surface-100">Source #{sourceId} · {selection.group.replaceAll('_', ' ')} = {display(selection.value)}</h3><button type="button" className={control} onClick={onClose}>Close source group events</button></div>
    <p className="text-xs text-surface-400">Exact same recorded label, including missing versus empty text, and exact source ID. Independent of event-list filters. Newest saved observation timestamp then event ID first, not arrival order. Saved labels do not verify a common incident or sensor health.</p>
    <p className="break-words text-xs text-surface-400">Prior loaded profile: {selection.profileCount} events · Read {selection.profileReadAt}. Counts can change between reads/pages; the profile is not rewritten by this drilldown.</p>
    {loading && <p role="status" className="text-xs text-surface-300">Reading exact source label events...</p>}{error && <p role="alert" className="text-xs text-danger">{error} No absence of activity is inferred.</p>}
    <button type="button" disabled={loading} className={control} onClick={() => setRetry(value => value + 1)}>Refresh exact source events</button>
    {!loading && !error && data && <>
      <p role="status" className="text-sm text-surface-200">{data.total} current matching source events · Page {page} of {Math.max(1, Math.ceil(data.total / 10))}</p><p className="break-words text-xs text-surface-400">Current event page read {data.retrieved_at}. Bounded saved metadata only, not raw payloads or a new scan.</p>
      {data.total !== selection.profileCount && <p className="text-xs text-warning">Current count {data.total} differs from the prior loaded profile count {selection.profileCount}. They are separate reads, not proof of deletion, arrival, data loss or duplicates.</p>}
      {!data.records.length && <p className="text-xs text-surface-300">No current owned events match this exact source label. This is not proof no activity occurred.</p>}
      <ol aria-label="Exact source group event rows" className="space-y-2">{data.records.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h4 className="whitespace-pre-wrap break-words font-semibold text-surface-100">Event #{row.id}: {row.signature ?? row.event_type}</h4><p className="break-words">{row.timestamp} · {row.event_type} · Recorded severity {display(row.severity)} · Processing {display(row.processed)}</p><p className="whitespace-pre-wrap break-words">{display(row.source_ip)} to {display(row.dest_ip)} · Host {display(row.hostname)}</p><a className="inline-block text-primary-300 underline" href={`/app/events/${row.id}`}>Open exact source event #{row.id}</a></li>)}</ol>
      <nav aria-label="Exact source group event pages" className="flex flex-wrap gap-2"><button type="button" disabled={page === 1} className={control} onClick={() => setPage(page - 1)}>Previous source events</button><button type="button" disabled={page * 10 >= data.total} className={control} onClick={() => setPage(page + 1)}>More source events</button></nav>
      <button type="button" className={control} onClick={download}>Download loaded source event page JSON</button><p className="text-xs text-surface-400">Only this loaded event page, not every matching event. Saved addresses and host names may be sensitive. Keep private; downloaded copies have no application access controls. No extra read or message.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
