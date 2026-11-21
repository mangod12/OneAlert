import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
const fields = ['source_ip', 'dest_ip', 'hostname', 'username', 'domain'] as const;
type Field = typeof fields[number];
interface Row { id: number; timestamp: string; event_type: string; severity: string | null; signature: string | null; source_ip: string | null; dest_ip: string | null; hostname: string | null; username: string | null; domain: string | null; source_type: string | null }
interface Result { event_id: number; field: Field; value: string; anchor_timestamp: string; hours: number; started_at: string; ended_before: string; page: number; size: number; total: number; records: Row[]; retrieved_at: string; scope: string }
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const control = 'max-w-full min-h-10 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function EventRecordedNeighbors({ eventId, event }: { eventId: number; event: Record<string, unknown> }) {
  const available = fields.filter(field => typeof event[field] === 'string' && String(event[field]).trim());
  const [draft, setDraft] = useState<{ field: Field; hours: number }>({ field: available[0] ?? 'source_ip', hours: 24 }), [applied, setApplied] = useState<typeof draft | null>(null);
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [data, setData] = useState<Result | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const request = useRef(0), dirty = applied !== null && (draft.field !== applied.field || draft.hours !== applied.hours);
  useEffect(() => {
    const read = ++request.current; setData(null); setError(''); setDownloadError('');
    if (!applied) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Result>(`/events/${eventId}/recorded-neighbors`, { params: { ...applied, page, size: 10 } }).then(({ data: value }) => {
      if (read !== request.current) return;
      if (!value || value.event_id !== eventId || value.field !== applied.field || value.hours !== applied.hours || typeof value.value !== 'string' || !value.value.trim() || value.page !== page || value.size !== 10 || !count(value.total) || !time(value.anchor_timestamp) || !time(value.started_at) || !time(value.ended_before) || !time(value.retrieved_at) || Date.parse(value.started_at) !== Date.parse(value.anchor_timestamp) - applied.hours * 3600000 || Date.parse(value.ended_before) !== Date.parse(value.anchor_timestamp) + applied.hours * 3600000 || typeof value.scope !== 'string' || !Array.isArray(value.records) || value.records.length > 10 || new Set(value.records.map(row => row?.id)).size !== value.records.length || value.records.some(row => !row || !count(row.id) || row.id < 1 || row.id === eventId || !time(row.timestamp) || Date.parse(row.timestamp) < Date.parse(value.started_at) || Date.parse(row.timestamp) >= Date.parse(value.ended_before) || typeof row.event_type !== 'string' || row[applied.field] !== value.value || (['severity', 'signature', 'source_ip', 'dest_ip', 'hostname', 'username', 'domain', 'source_type'] as const).some(key => row[key] !== null && typeof row[key] !== 'string'))) throw Error('Recorded neighbors did not match the exact anchor field and complete time scope. Retry before relying on them.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw Error('Recorded neighbors returned an incomplete page. No absence is inferred.');
      setData(value);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Recorded neighbors unavailable. No absence of activity is inferred.')); }).finally(() => { if (read === request.current) setLoading(false); });
    const invalidate = () => { request.current++; }; return invalidate;
  }, [eventId, applied, page, retry]);
  const download = () => {
    if (!data || dirty) return;
    setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_recorded_event_neighbor_page_v1', exported_at: new Date().toISOString(), ...data, download_scope: 'Only this currently loaded result page, not every matching event or a forensic archive. Potentially sensitive recorded system/person metadata; review before sharing. No new read, message or permission change.' }, null, 2) + '\n', `event-${eventId}-recorded-neighbors-page-${page}.json`, 'application/json'); }
    catch { setDownloadError('The loaded neighbor page could not be downloaded. No records changed.'); }
  };
  return <section aria-label="Recorded event field neighbors" className="oa-panel space-y-3 p-4">
    <h2 className="font-semibold text-surface-100">Find nearby records with the same saved field</h2>
    <p className="text-xs text-surface-400">Pivot from this event's saved source IP, destination IP, hostname, username or domain. Exact same-field string equality only, not cross-field matching, IP canonicalization or a lookup. A shared label does not prove the same person, system, incident or compromise. No AI, scan or external lookup is performed.</p>
    {!available.length ? <p className="text-sm text-surface-400">No supported nonempty entity fields are recorded in this loaded event.</p> : <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setApplied({ ...draft }); setPage(1); setRetry(value => value + 1); }}>
        <label className="min-w-0 basis-full flex-1 text-xs text-surface-300 sm:basis-64">Exact recorded field<select aria-label="Neighbor anchor field" className={`${control} mt-1 block w-full`} value={draft.field} onChange={e => setDraft(value => ({ ...value, field: e.target.value as Field }))}>{available.map(field => <option key={field} value={field}>{field.replaceAll('_', ' ')}: {String(event[field])}</option>)}</select></label>
        <label className="text-xs text-surface-300">Hours each side of anchor<select aria-label="Neighbor hours each side" className={`${control} mt-1 block`} value={draft.hours} onChange={e => setDraft(value => ({ ...value, hours: Number(e.target.value) }))}>{[1, 6, 24, 72, 168].map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? 'hour' : 'hours'} before/after</option>)}</select></label>
        <button type="submit" className={control}>Read exact recorded neighbors</button><button type="button" className={control} onClick={() => { request.current++; setApplied(null); setData(null); setLoading(false); setError(''); setDownloadError(''); setPage(1); }}>Clear recorded neighbors</button>
      </form>
      <p className="whitespace-pre-wrap break-words text-xs text-surface-300">Selected loaded field: {draft.field.replaceAll('_', ' ')} = {String(event[draft.field])}</p>
      <p className="text-xs text-surface-400">The server rereads the current owned anchor and derives its field value and UTC time window. The anchor itself is excluded. Start is inclusive, end is exclusive. Saved timestamps do not establish causality or ingestion order. Current anchor, records and counts can change between pages.</p>
      {dirty && <p role="status" className="text-xs text-warning">Field/window drafts are not applied. Results still use the last submitted scope; apply or clear before paging or download.</p>}
      {loading && <p role="status" className="text-xs text-surface-300">Reading exact saved-field neighbors...</p>}{error && <p role="alert" className="text-xs text-danger">{error} No absence of matching activity is inferred. Read again to retry.</p>}
      {!loading && !error && data && <>
        <p role="status" className="break-words text-sm text-surface-200">{data.total} other matching recorded events · Page {page} of {Math.max(1, Math.ceil(data.total / 10))}</p>
        <p className="whitespace-pre-wrap break-words text-xs text-surface-400">Applied current anchor #{data.event_id}: {data.field.replaceAll('_', ' ')} = {data.value}. Anchor time {data.anchor_timestamp}. UTC window {data.started_at} inclusive to {data.ended_before} exclusive. Read {data.retrieved_at}.</p>
        {(data.value !== event[data.field] || (time(event.timestamp) && Date.parse(event.timestamp) !== Date.parse(data.anchor_timestamp))) && <p className="text-xs text-warning">The anchor field or timestamp changed since the event evidence above was loaded. These results use the server's current saved value. Refresh the event evidence to review it; that clears this neighbor read.</p>}
        {!data.records.length && <p className="text-xs text-surface-400">No other saved records match this exact field/window. This is not proof no related activity occurred.</p>}
        <ol aria-label="Recorded field neighbor events" className="space-y-2">{data.records.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h3 className="break-words font-semibold text-surface-100">Event #{row.id}: {row.signature ?? row.event_type}</h3><p className="break-words">{row.timestamp} · {row.event_type} · Recorded severity {row.severity ?? 'not recorded'} · Source type {row.source_type ?? 'not recorded'}</p><p className="whitespace-pre-wrap break-words">{row.source_ip ?? '(no source IP)'} to {row.dest_ip ?? '(no destination IP)'} · Host {row.hostname ?? '(not recorded)'} · User {row.username ?? '(not recorded)'} · Domain {row.domain ?? '(not recorded)'}</p><a className="inline-block text-primary-300 underline" href={`/app/events/${row.id}`}>Open exact neighbor event #{row.id}</a></li>)}</ol>
        <nav aria-label="Recorded neighbor pages" className="flex flex-wrap gap-2"><button type="button" disabled={dirty || page === 1} className={control} onClick={() => setPage(page - 1)}>Previous neighbor page</button><button type="button" disabled={dirty || page * 10 >= data.total} className={control} onClick={() => setPage(page + 1)}>More neighbor records</button><button type="button" disabled={dirty} className={control} onClick={() => setRetry(value => value + 1)}>Refresh applied neighbors</button></nav>
        <button type="button" disabled={dirty} className={control} onClick={download}>Download this loaded neighbor page JSON</button><p className="text-xs text-surface-400">Only the displayed result page is included, not all matching events. Saved names and addresses can be sensitive. Keep private; downloaded copies have no application access controls. No new read or message is sent.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
      </>}
    </>}
  </section>;
}
