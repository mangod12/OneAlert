import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
const limits = { event_type: 64, severity: 64, signature: 300, source_ip: 128, dest_ip: 128 } as const;
type Field = keyof typeof limits;
interface EventRow { id: number; timestamp: string; event_type: string; severity: string | null; signature: string | null; source_ip: string | null; dest_ip: string | null; shortened_fields: Field[] }
interface Evidence { run_id: number; step_id: number; window_from: string; window_until: string; recorded_total_events: number; total: number; page: number; size: number; records: EventRow[]; retrieved_at: string; scope: string }
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const time = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const display = (v: string | null) => v === null ? '(not recorded)' : v === '' ? '(empty text)' : v;
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function DetectionWindowEvents({ runId, stepId }: { runId: number; stepId: number }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<Evidence | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    const version = ++request.current; setData(null); setError(''); setDownloadError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Evidence>(`/cases/agents/runs/${runId}/detection-receipts/${stepId}/events`, { params: { page, size: 10 } }).then(({ data: value }) => {
      if (version !== request.current) return;
      if (!value || value.run_id !== runId || value.step_id !== stepId || value.page !== page || value.size !== 10 || !count(value.total) || !count(value.recorded_total_events) || !time(value.window_from) || !time(value.window_until) || Date.parse(value.window_until) <= Date.parse(value.window_from) || Date.parse(value.window_until) - Date.parse(value.window_from) > 168 * 3600000 || !time(value.retrieved_at) || typeof value.scope !== 'string' || !value.scope || !Array.isArray(value.records) || value.records.length > 10 || new Set(value.records.map(row => row?.id)).size !== value.records.length || value.records.some((row, index) => !row || !count(row.id) || row.id < 1 || !time(row.timestamp) || Date.parse(row.timestamp) < Date.parse(value.window_from) || Date.parse(row.timestamp) > Date.parse(value.window_until) || typeof row.event_type !== 'string' || Object.entries(limits).some(([key, cap]) => { const text = row[key as Field]; return text !== null && (typeof text !== 'string' || Array.from(text).length > cap); }) || !Array.isArray(row.shortened_fields) || new Set(row.shortened_fields).size !== row.shortened_fields.length || row.shortened_fields.some(key => !(key in limits) || typeof row[key] !== 'string' || Array.from(row[key] as string).length !== limits[key]) || (index > 0 && (Date.parse(row.timestamp) < Date.parse(value.records[index - 1].timestamp) || (row.timestamp === value.records[index - 1].timestamp && row.id <= value.records[index - 1].id))))) throw Error('The event page did not match this saved run receipt and bounded window. Read it again before relying on it.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw Error('The saved-window event page was incomplete. No absence is inferred.');
      setData(value);
    }).catch(reason => { if (version === request.current) setError(getApiErrorMessage(reason, 'Saved detection-window events unavailable.')); }).finally(() => { if (version === request.current) setLoading(false); });
    const invalidate = () => { request.current++; }; return invalidate;
  }, [runId, stepId, open, page, retry]);
  const download = () => {
    if (!data) return;
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_detection_window_event_page_v1', exported_at: new Date().toISOString(), ...data, download_scope: 'Only this loaded current page, not the original run snapshot or every matching event. Saved addresses may be sensitive; keep private. Downloaded copies have no application access controls. No extra read or message.' }, null, 2) + '\n', `detection-run-${runId}-receipt-${stepId}-events-page-${page}.json`, 'application/json'); setDownloadError(''); }
    catch { setDownloadError('The loaded event page could not be downloaded. No records changed.'); }
  };
  return <section aria-label="Saved detection window event evidence" className="mt-3 space-y-3 rounded border border-surface-700 p-3">
    <button type="button" aria-expanded={open} className={control} onClick={() => { setOpen(value => !value); setPage(1); }}>Read current events for this saved detection receipt</button>
    {open && <>
      <p className="text-xs text-surface-400">Exact owned run #{runId}, receipt step #{stepId}. The server reads the saved receipt bounds, not a new default lookback. These are currently retained event rows in that timestamp window, not the original run snapshot, proof that AI reviewed them, or proof that each row supports a finding. No scan or agent is run.</p>
      {loading && <p role="status" className="text-xs text-surface-300">Reading current events in the saved detection window...</p>}
      {error && <p role="alert" className="text-xs text-danger">{error} No absence of activity is inferred.</p>}
      <button type="button" disabled={loading} className={control} onClick={() => setRetry(v => v + 1)}>Refresh saved-window event evidence</button>
      {!loading && !error && data && data.page === page && data.run_id === runId && data.step_id === stepId && <>
        <p role="status" className="text-sm text-surface-200">{data.total} current window events · Page {page} of {Math.max(1, Math.ceil(data.total / 10))}</p>
        <p className="break-words text-xs text-surface-400">Saved bounds {data.window_from} to {data.window_until}, both inclusive. Recorded run count {data.recorded_total_events}. Current page read {data.retrieved_at}. Counts and pages are separate current reads.</p>
        {data.total !== data.recorded_total_events && <p className="text-xs text-warning">Current count {data.total} differs from the recorded run count {data.recorded_total_events}. This is not proof of deletion, arrival or data loss.</p>}
        {!data.records.length && <p className="text-xs text-surface-300">No current owned events remain in this saved window. This does not establish that no activity occurred.</p>}
        <ol aria-label="Current saved-window event rows" className="space-y-2">{data.records.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h5 className="whitespace-pre-wrap break-words font-semibold text-surface-100">Event #{row.id}: {row.signature === null ? row.event_type : display(row.signature)}</h5><p className="break-words">{row.timestamp} · {row.event_type} · Recorded severity {display(row.severity)}</p><p className="whitespace-pre-wrap break-words">{display(row.source_ip)} to {display(row.dest_ip)}</p>{row.shortened_fields.length > 0 && <p className="text-warning">Shortened saved metadata: {row.shortened_fields.join(', ')}. Open the exact event for its current record.</p>}<a className="inline-block text-primary-300 underline" href={`/app/events/${row.id}`}>Open exact detection-window event #{row.id}</a></li>)}</ol>
        <nav aria-label="Saved detection-window event pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={page === 1} onClick={() => setPage(v => v - 1)}>Previous detection-window events</button><button type="button" className={control} disabled={page * 10 >= data.total} onClick={() => setPage(v => v + 1)}>More detection-window events</button></nav>
        <button type="button" className={control} onClick={download}>Download loaded detection-window event page JSON</button><p className="text-xs text-surface-400">Only this loaded current page, not the original run snapshot or all window events. Saved addresses may be sensitive. Keep private; downloaded copies have no application access controls. No extra read or message.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
      </>}
    </>}
  </section>;
}
