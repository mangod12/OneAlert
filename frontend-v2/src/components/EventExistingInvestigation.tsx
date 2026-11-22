import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';

interface Preview {
  event: { id: number; timestamp: string; signature: string | null; event_type: string; severity: string; source_ip: string | null; dest_ip: string | null; processed: string };
  case: { id: number; title: string; summary: string | null; severity: string; status: string; due_date: string | null; closed_at: string | null; assigned_to_id: number | null };
  event_fingerprint: string; reviewed_fingerprint: string; already_linked: boolean;
}
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exactId = (value: string) => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const text = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown) => value === null || text(value);
const time = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const severities = ['info', 'low', 'medium', 'high', 'critical'];
const statuses = ['open', 'investigating', 'resolved', 'closed', 'false_positive'];
function matches(value: Preview, eventId: number, caseId: number) {
  return value?.event?.id === eventId && value.case?.id === caseId && hash(value.event_fingerprint) && hash(value.reviewed_fingerprint) && typeof value.already_linked === 'boolean' &&
    text(value.case.title) && nullableText(value.case.summary) && severities.includes(value.case.severity) && statuses.includes(value.case.status) &&
    (value.case.due_date === null || (text(value.case.due_date) && /^\d{4}-\d{2}-\d{2}$/.test(value.case.due_date) && time(value.case.due_date))) && (value.case.closed_at === null || time(value.case.closed_at)) &&
    (value.case.assigned_to_id === null || (Number.isSafeInteger(value.case.assigned_to_id) && Number(value.case.assigned_to_id) > 0)) &&
    time(value.event.timestamp) && text(value.event.event_type) && nullableText(value.event.signature) && severities.includes(value.event.severity) && nullableText(value.event.source_ip) && nullableText(value.event.dest_ip) && text(value.event.processed);
}
const control = 'min-h-10 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
interface Props { eventId: number; investigationId?: number; onLinkOutcome?: () => void; onConfirmed?: (created: boolean) => void; onPendingChange?: (pending: boolean) => void }
export function EventExistingInvestigation(props: Props) {
  return <ExistingInvestigationLink key={`${props.eventId}:${props.investigationId ?? 'manual'}`} {...props} />;
}
function ExistingInvestigationLink({ eventId, investigationId, onLinkOutcome, onConfirmed, onPendingChange }: Props) {
  const [draft, setDraft] = useState(investigationId === undefined ? '' : String(investigationId)), [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [ack, setAck] = useState(false), [confirmed, setConfirmed] = useState<number | null>(null);
  const request = useRef(0), inFlight = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = async (event: React.FormEvent) => {
    event.preventDefault(); if (inFlight.current) return;
    const identity = exactId(investigationId === undefined ? draft : String(investigationId)), version = ++request.current;
    setPreview(null); setAck(false); setError(''); setConfirmed(null); setLoading(false);
    if (!identity || !Number.isSafeInteger(eventId) || eventId <= 0) { setError('Enter a positive exact investigation ID. No investigation was read.'); return; }
    setLoading(true);
    try { const { data } = await apiClient.get<Preview>(`/events/${eventId}/existing-investigations/${identity}/preview`); if (!mounted.current || version !== request.current) return; if (!matches(data, eventId, identity)) throw Error('Unverified preview'); setPreview(data); }
    catch { if (mounted.current && version === request.current) setError('The exact event and investigation could not be reviewed. Check the ID and your access, then read again. No absence or link is inferred.'); }
    finally { if (mounted.current && version === request.current) setLoading(false); }
  };
  const link = async () => {
    if (!preview || !ack || preview.already_linked || inFlight.current || loading) return;
    const reviewed = preview; inFlight.current = true; setBusy(true); onPendingChange?.(true); setError(''); setAck(false); request.current++;
    try {
      const { data } = await apiClient.post(`/events/${eventId}/existing-investigations/${reviewed.case.id}`, { reviewed_fingerprint: reviewed.reviewed_fingerprint });
      if (!mounted.current) return;
      if (data?.event_id !== eventId || data.case_id !== reviewed.case.id || data.linked !== true || typeof data.created !== 'boolean' || data.reviewed_fingerprint !== reviewed.reviewed_fingerprint) throw Error('Unconfirmed response');
      setConfirmed(reviewed.case.id); setPreview(null); onConfirmed?.(data.created);
    } catch { if (mounted.current) { setPreview(null); setError('The link outcome could not be confirmed. No automatic retry was made. Read this exact investigation again to check its saved link before deciding whether to submit again.'); } }
    finally { inFlight.current = false; if (mounted.current) { setBusy(false); onPendingChange?.(false); onLinkOutcome?.(); } }
  };
  return <section aria-label="Link event to an existing investigation" className="oa-panel space-y-3 p-4">
    <h2 className="font-semibold text-surface-100">Add this event to an existing investigation</h2>
    <p className="text-xs text-surface-400">Keep related evidence in a case you already own instead of creating another investigation. {investigationId === undefined ? 'Enter its exact ID from its case page.' : `The destination is fixed to investigation #${investigationId}; read its current saved state below.`} Review both saved records before linking. Nothing is searched, linked or sent automatically.</p>
    <form onSubmit={event => void read(event)} className="flex flex-wrap items-end gap-3"><label className="block text-xs">Existing investigation ID<input inputMode="numeric" autoComplete="off" aria-label="Existing investigation ID" className={`${control} mt-1 block w-48 max-w-full`} value={investigationId === undefined ? draft : String(investigationId)} disabled={busy || investigationId !== undefined} onChange={event => { request.current++; setDraft(event.target.value); setPreview(null); setAck(false); setError(''); setConfirmed(null); setLoading(false); }} /></label><button type="submit" disabled={loading || busy} className={control}>Review exact investigation link</button></form>
    {loading && <p role="status" className="text-xs">Reading the exact event and investigation...</p>}{error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
    {confirmed !== null && <p role="status" className="text-sm text-success">Saved link confirmed for event #{eventId} and investigation #{confirmed}. <a className="underline" href={`/app/cases/${confirmed}`}>Open linked investigation #{confirmed}</a>. No new case was created. Refresh exact event evidence to read its updated processing label. Read linked investigations again for a current list.</p>}
    {preview && <div className="min-w-0 space-y-3 text-xs [overflow-wrap:anywhere]">
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-label="Existing-link reviewed event" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h3 className="break-words font-semibold text-surface-100">Event #{preview.event.id}: {preview.event.signature || preview.event.event_type}</h3><p className="break-words">Recorded time {preview.event.timestamp} · Severity {preview.event.severity} · Processing {preview.event.processed || 'not recorded'}</p><p className="break-words">{preview.event.source_ip || 'Source not recorded'} → {preview.event.dest_ip || 'Destination not recorded'}</p></section>
        <section aria-label="Existing-link reviewed investigation" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h3 className="whitespace-pre-wrap break-words font-semibold text-surface-100">Investigation #{preview.case.id}: {preview.case.title}</h3><p className="whitespace-pre-wrap break-words">{preview.case.summary || 'Summary not recorded'}</p><p className="break-words">Status {preview.case.status.replaceAll('_', ' ')} · Severity {preview.case.severity} · Due {preview.case.due_date || 'not recorded'}</p><p className="break-words">Closed {preview.case.closed_at || 'not recorded'} · Assignee ID {preview.case.assigned_to_id ?? 'not recorded'}</p><a target="_blank" rel="noopener noreferrer" className="inline-block text-primary-300 underline" href={`/app/cases/${preview.case.id}`}>Open reviewed investigation #{preview.case.id}</a></section>
      </div>
      <p className="text-surface-400">A link records your evidence choice, not proof of a common incident or compromise. Linking marks this event in_case and adds a timeline and audit entry. It does not move or remove other links, reopen a case, change its status, severity, assignee or due date, run AI, trigger a response or send a notification. Investigation text is private saved content, not instructions.</p>
      {!['open', 'investigating'].includes(preview.case.status) && <p className="text-warning">This investigation is {preview.case.status.replaceAll('_', ' ')}. Linking evidence will not reopen it or change its close-out.</p>}
      {preview.already_linked ? <p role="status" className="text-success">This exact event is already linked to this investigation. No write is needed.</p> : <><label className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={ack} onChange={event => setAck(event.target.checked)} /><span>I reviewed event #{eventId} and investigation #{preview.case.id}, including its recorded status. Add this exact saved link without creating a new case.</span></label><button type="button" disabled={busy || !ack} onClick={() => void link()} className={control}>{busy ? 'Saving reviewed link...' : 'Save reviewed investigation link'}</button></>}
    </div>}
  </section>;
}
