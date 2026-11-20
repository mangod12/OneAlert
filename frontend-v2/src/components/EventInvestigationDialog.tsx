import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Preview { event: { id: number; timestamp: string; event_type: string; signature: string | null; severity: string; source_ip: string | null; dest_ip: string | null; processed: string }; event_fingerprint: string; reviewed_fingerprint: string; existing_case_count: number; existing_cases: { id: number; title: string; status: string }[]; due_dates: Record<string, string | null> }
const severities = ['info', 'low', 'medium', 'high', 'critical'];
const fingerprint = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function EventInvestigationDialog({ eventId, onCancel }: { eventId: number; onCancel: () => void }) {
  const dialog = useRef<HTMLDivElement | null>(null), inFlight = useRef(false), request = useRef(0), initialized = useRef(false), mounted = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [mustRefresh, setMustRefresh] = useState(false), [ack, setAck] = useState(false);
  const [title, setTitle] = useState(''), [summary, setSummary] = useState(''), [severity, setSeverity] = useState('medium');
  const navigate = useNavigate(); const close = () => { if (!inFlight.current) onCancel(); }; useDialogFocus(dialog, close);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const read = ++request.current; setPreview(null); setError(''); setLoading(true); setAck(false);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) { setLoading(false); setError('A positive exact saved event ID is required.'); return; }
    void apiClient.get<Preview>(`/events/${eventId}/investigation-preview`).then(({ data }) => {
      if (read !== request.current) return;
      if (data.event?.id !== eventId || !fingerprint(data.reviewed_fingerprint) || !fingerprint(data.event_fingerprint) || !Number.isSafeInteger(data.existing_case_count) || data.existing_case_count < 0 || !Array.isArray(data.existing_cases) || data.existing_cases.length > 20 || data.existing_cases.length > data.existing_case_count || new Set(data.existing_cases.map(item => item.id)).size !== data.existing_cases.length || data.existing_cases.some(item => !Number.isSafeInteger(item.id) || item.id <= 0) || !data.due_dates || severities.some(value => !(value in data.due_dates) || (data.due_dates[value] !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data.due_dates[value])))) throw new Error('The investigation preview did not match this exact event. Refresh before creating anything.');
      setPreview(data); setMustRefresh(false);
      if (!initialized.current) { initialized.current = true; setTitle(`Investigate: ${data.event.signature || data.event.event_type}`.slice(0, 200)); setSeverity(severities.includes(data.event.severity) ? data.event.severity : 'medium'); }
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Investigation preview could not be loaded.')); }).finally(() => { if (read === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [eventId, retry]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (inFlight.current || !preview || !ack || mustRefresh || loading || !title.trim()) return;
    inFlight.current = true; setBusy(true); setError(''); let confirmed = false;
    try {
      const { data } = await apiClient.post(`/events/${eventId}/investigations`, { title: title.trim(), summary: summary.trim() || null, severity, reviewed_fingerprint: preview.reviewed_fingerprint });
      if (!mounted.current) return;
      if (!Number.isSafeInteger(data.id) || data.id <= 0 || data.event_id !== eventId || data.linked !== true || data.reviewed_fingerprint !== preview.reviewed_fingerprint) throw new Error('The response did not confirm this exact investigation and event link.');
      confirmed = true; navigate(`/cases/${data.id}`);
    } catch (err) { if (!mounted.current) return; setMustRefresh(true); setAck(false); setError(`${getApiErrorMessage(err, 'The investigation outcome could not be confirmed.')} No automatic retry was made. Refresh the preview and check existing investigations before deciding whether to create another.`); }
    finally { if (!confirmed) { inFlight.current = false; if (mounted.current) setBusy(false); } }
  };
  return <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"><div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={close} /><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="event-investigation-title" className="relative max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 text-surface-200">
    <h2 id="event-investigation-title" className="text-lg font-semibold text-surface-50">Open investigation</h2><p className="text-xs text-surface-400">Review saved event #{eventId} and any linked investigations first. This creates one new investigation and links this exact event in one transaction. It does not verify telemetry, run a response action or send a team notification.</p>
    <button type="button" disabled={loading || busy} onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Refresh investigation preview</button>
    {(!preview || loading) && <button type="button" onClick={close} disabled={busy} className="rounded border border-surface-600 px-3 py-2 text-sm">Cancel</button>}
    {loading && <p role="status" className="text-sm">Loading investigation preview...</p>}{error && <p role="alert" className="break-words text-sm text-danger">{error}</p>}
    {!loading && preview && <>
      <section aria-label="Reviewed saved event" className="space-y-2 rounded border border-surface-700 p-3 text-xs"><h3 className="break-words font-semibold">{preview.event.signature || preview.event.event_type} · Event #{eventId}</h3><p className="break-words">{preview.event.timestamp} · Recorded severity: {preview.event.severity} · Processing label: {preview.event.processed || 'Not recorded'}</p><p className="break-words">{preview.event.source_ip || 'Source not recorded'} → {preview.event.dest_ip || 'Destination not recorded'}</p><a href={`/app/events/${eventId}`} target="_blank" rel="noopener noreferrer" className="inline-block text-primary-300">Open exact saved event evidence</a></section>
      <section aria-label="Existing event investigations" className="space-y-2 text-xs"><h3 className="font-semibold">{preview.existing_case_count} linked investigations owned by your account</h3><p className="text-surface-400">Up to 20 newest owned investigations are shown, including closed cases. Other people's private cases are not included. A linked case does not establish a common incident.</p>{preview.existing_cases.length ? <ul className="space-y-2">{preview.existing_cases.map(item => <li key={item.id} className="break-words"><a href={`/app/cases/${item.id}`} className="text-primary-300">Case #{item.id}: {item.title}</a> · {item.status}</li>)}</ul> : <p>No owned linked investigations were found in this read.</p>}</section>
      <form onSubmit={event => void submit(event)} className="space-y-3">
        <label className="block space-y-1 text-xs">Title<input aria-label="Title" maxLength={200} disabled={busy} value={title} onChange={event => { setTitle(event.target.value); setAck(false); }} className="block w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm" /></label>
        <label className="block space-y-1 text-xs">Summary<textarea aria-label="Summary" maxLength={2000} rows={3} disabled={busy} value={summary} onChange={event => { setSummary(event.target.value); setAck(false); }} className="block w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm" /></label>
        <label className="block space-y-1 text-xs">Severity<select aria-label="Severity" disabled={busy} value={severity} onChange={event => { setSeverity(event.target.value); setAck(false); }} className="block w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm">{severities.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <p className="text-xs text-surface-400">New case status: open · SLA due date: {preview.due_dates[severity] || 'Not set'}. The event processing label will become in_case.</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={ack} disabled={busy || mustRefresh} onChange={event => setAck(event.target.checked)} /><span>I reviewed this saved event, existing investigations and the new case details. Create a new investigation, not a link to an existing one.</span></label>
        <div className="flex flex-wrap justify-end gap-3"><button type="button" onClick={close} disabled={busy} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Cancel</button><button type="submit" disabled={busy || !ack || mustRefresh || !title.trim()} className="rounded border border-primary-500 bg-primary-500/10 px-3 py-2 text-sm text-primary-200 disabled:opacity-40">{busy ? 'Opening investigation...' : 'Create reviewed investigation'}</button></div>
      </form>
    </>}
  </div></div>;
}
