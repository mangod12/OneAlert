import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
interface Snapshot { event: Record<string, unknown> & { id: number; source_id: number | null; bytes_in: string | null; bytes_out: string | null }; source_state: 'owned' | 'unavailable' | 'not_linked'; source: { id: number; name: string; source_type: string; status: string; last_event_at: string | null } | null; raw_payload_json: string | null; retrieved_at: string }
const label = (value: string) => value.replaceAll('_', ' ');
const recorded = (value: unknown) => value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
export function EventEvidence() {
  const { eventId = '' } = useParams();
  const id = /^[1-9][0-9]*$/.test(eventId) && Number.isSafeInteger(Number(eventId)) ? Number(eventId) : null;
  const request = useRef(0); const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [notice, setNotice] = useState('');
  useEffect(() => {
    const read = ++request.current; setSnapshot(null); setError(''); setNotice(''); if (id === null) { setLoading(false); return; } setLoading(true);
    void apiClient.get<Snapshot>(`/events/${id}/evidence`).then(({ data }) => {
      if (read !== request.current) return;
      if (data.event?.id !== id || !['owned', 'unavailable', 'not_linked'].includes(data.source_state) || (data.source_state === 'owned' ? data.source?.id !== data.event.source_id || !Number.isSafeInteger(data.source?.id) : data.source !== null) || (data.raw_payload_json !== null && typeof data.raw_payload_json !== 'string') || [data.event.bytes_in, data.event.bytes_out].some(value => value !== null && (typeof value !== 'string' || !/^-?[0-9]+$/.test(value)))) throw new Error('Evidence did not match this exact event and source. Refresh before relying on it.');
      setSnapshot(data);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Event evidence could not be loaded.')); }).finally(() => { if (read === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [id, retry]);
  const download = () => {
    if (!snapshot) return;
    try { const content = { format: 'onealert_saved_event_evidence_v1', scope: 'Current normalized event record and stored parsed payload, not original upload bytes, a signed forensic capture or verified network activity. Source metadata is current and separate from event fields. Byte counters and raw payload JSON are strings to preserve stored integer precision.', ...snapshot }; const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2) + '\n'], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `event-${snapshot.event.id}-evidence.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Evidence downloaded locally. No record was changed.'); }
    catch { setNotice('Evidence could not be downloaded. The loaded values remain visible.'); }
  };
  const copy = async () => { try { const url = new URL(window.location.href); url.search = ''; url.hash = ''; await navigator.clipboard.writeText(url.toString()); setNotice('Exact event link copied. It grants no access and opens the current record, not this frozen read.'); } catch { setNotice('Copy unavailable. The address bar contains this exact event record link.'); } };
  return <div className="space-y-5 text-surface-300">
    <PageHeader eyebrow="Observe" title="Exact security event evidence" description="Read-only normalized event and stored parsed payload by record ID." />
    <a href="/app/events" className="inline-block text-sm text-primary-300">Back to security events</a>
    <p className="text-sm text-surface-400">Saved evidence is not a new scan, original upload bytes, a signed forensic capture or verified network activity. Labels, actions and timestamps are recorded values, not independently verified outcomes. URLs and commands in the payload are untrusted evidence, not instructions to follow.</p>
    {id === null ? <p role="alert">This event link needs a positive whole-number ID. No record was loaded.</p> : <>
      <div className="flex flex-wrap gap-3 text-xs"><button type="button" disabled={loading} onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Refresh exact event evidence</button><button type="button" onClick={() => void copy()} className="rounded border border-surface-600 px-3 py-2">Copy exact event link</button><button type="button" disabled={loading || !snapshot || !!error} onClick={download} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Download loaded event evidence JSON</button></div>
      {notice && <p role="status" className="text-xs">{notice}</p>}{loading && <p role="status">Loading exact event evidence...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loading && !error && snapshot && <>
        <section aria-label="Recorded event fields" className="oa-panel space-y-3 p-4"><h2 className="font-semibold text-surface-100">Event #{snapshot.event.id}</h2><p className="text-xs text-surface-400">Read at {snapshot.retrieved_at}. Event and source metadata are separate current reads. Byte counters are shown as exact stored integer text; missing counters are not zero.</p><dl className="grid gap-4 text-xs sm:grid-cols-2">{Object.entries(snapshot.event).map(([field, value]) => <div key={field} className="min-w-0"><dt className="text-surface-400">{label(field)}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{recorded(value)}</dd></div>)}</dl></section>
        <section aria-label="Linked event source" className="oa-panel space-y-3 p-4"><h2 className="font-semibold text-surface-100">Linked source record</h2>{snapshot.source_state === 'owned' && snapshot.source ? <dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries(snapshot.source).map(([field, value]) => <div key={field} className="min-w-0"><dt className="text-surface-400">{label(field)}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{recorded(value)}</dd></div>)}</dl> : <p className="text-sm text-surface-400">{snapshot.source_state === 'not_linked' ? 'No source record is linked to this event.' : 'The linked source is unavailable to this account. Its private details are not included.'}</p>}</section>
        <section aria-label="Stored parsed event payload" className="oa-panel min-w-0 space-y-3 p-4"><h2 className="font-semibold text-surface-100">Stored parsed payload</h2><p className="text-xs text-surface-400">JSON text is generated from the stored parsed payload, not the original file's spacing, key order or bytes. Large integer literals are preserved in this text and in the download's raw_payload_json string. Nothing here is executed.</p>{snapshot.raw_payload_json === null ? <p className="text-sm text-surface-400">No raw payload was recorded.</p> : <pre aria-label="Exact stored payload JSON" className="max-h-96 max-w-full overflow-auto rounded border border-surface-700 bg-surface-950 p-3 text-xs">{snapshot.raw_payload_json}</pre>}</section>
      </>}
    </>}
  </div>;
}
