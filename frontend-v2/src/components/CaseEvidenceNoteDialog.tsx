import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { useDialogFocus } from './ui/useDialogFocus';
type Kind = 'alert' | 'event';
interface Preview {
  case: { id: number; title: string; summary: string | null; status: string; severity: string; due_date: string | null; closed_at: string | null };
  kind: Kind; record: { id: number; label: string | null; severity: string | null; recorded_at: string | null; processing_label: string | null };
  link_count: number; other_owned_case_count: number; record_fingerprint: string; reviewed_fingerprint: string;
  note_count: number; recent_notes: { id: number; content: string; timestamp: string; author_id: number | null; record_fingerprint: string }[];
}
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === 'string';
const optional = (value: unknown) => value === null || text(value);
const time = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const hash = (value: unknown) => text(value) && /^[a-f0-9]{64}$/.test(value);
const identity = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const control = 'min-h-10 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 disabled:opacity-40';
interface Props { caseId: number; kind: Kind; recordId: number; onCancel: () => void; onSaved: (noteId: number, created: boolean) => void }
export function CaseEvidenceNoteDialog(props: Props) {
  return <NoteDialog key={`${props.caseId}:${props.kind}:${props.recordId}`} {...props} />;
}
function NoteDialog({ caseId, kind, recordId, onCancel, onSaved }: Props) {
  const dialog = useRef<HTMLDivElement | null>(null), inFlight = useRef(false), mounted = useRef(false), request = useRef(0);
  const [preview, setPreview] = useState<Preview | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [content, setContent] = useState(''), [ack, setAck] = useState(false), [busy, setBusy] = useState(false);
  const close = () => { if (!inFlight.current) onCancel(); }; useDialogFocus(dialog, close);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const version = ++request.current; setPreview(null); setAck(false); setError(''); setLoading(false);
    if (!identity(caseId) || !identity(recordId) || !['alert', 'event'].includes(kind)) { setError('Positive exact investigation and evidence IDs are required. No record was loaded.'); return; }
    setLoading(true);
    void apiClient.get<Preview>(`/cases/${caseId}/evidence/${kind}/${recordId}/note-preview`).then(({ data }) => {
      if (!mounted.current || version !== request.current) return;
      if (data?.case?.id !== caseId || data.kind !== kind || data.record?.id !== recordId || !text(data.case.title) || !optional(data.case.summary) || !text(data.case.status) || !text(data.case.severity) || (data.case.due_date !== null && (!text(data.case.due_date) || !/^\d{4}-\d{2}-\d{2}$/.test(data.case.due_date) || !time(data.case.due_date))) || (data.case.closed_at !== null && !time(data.case.closed_at)) || !optional(data.record.label) || !optional(data.record.severity) || !optional(data.record.processing_label) || (data.record.recorded_at !== null && !time(data.record.recorded_at)) || !count(data.link_count) || !count(data.other_owned_case_count) || !hash(data.record_fingerprint) || !hash(data.reviewed_fingerprint) || !count(data.note_count) || !Array.isArray(data.recent_notes) || data.recent_notes.length !== Math.min(5, data.note_count) || new Set(data.recent_notes.map(note => note?.id)).size !== data.recent_notes.length || data.recent_notes.some(note => !identity(note?.id) || !text(note.content) || !time(note.timestamp) || (note.author_id !== null && !identity(note.author_id)) || !hash(note.record_fingerprint))) throw Error('Mismatched preview');
      setPreview(data);
    }).catch(() => { if (mounted.current && version === request.current) setError('The exact owned investigation, evidence and recent notes could not be reviewed. Refresh before adding a note. No absence is inferred.'); }).finally(() => { if (mounted.current && version === request.current) setLoading(false); });
    return () => { request.current = version + 1; };
  }, [caseId, kind, recordId, retry]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (inFlight.current || loading || !preview || !preview.link_count || !ack || !content.trim() || content.length > 2000) return;
    const reviewed = preview, submitted = content.trim(); inFlight.current = true; setBusy(true); setError(''); setAck(false);
    try {
      const { data } = await apiClient.post(`/cases/${caseId}/evidence/${kind}/${recordId}/notes`, { reviewed_fingerprint: reviewed.reviewed_fingerprint, content: submitted });
      if (!mounted.current) return;
      if (data?.case_id !== caseId || data.kind !== kind || data.record_id !== recordId || !identity(data.note_id) || typeof data.created !== 'boolean' || data.content !== submitted || data.reviewed_fingerprint !== reviewed.reviewed_fingerprint || data.record_fingerprint !== reviewed.record_fingerprint) throw Error('Unconfirmed note');
      onSaved(data.note_id, data.created);
    } catch { if (mounted.current) { setPreview(null); setError('The note outcome could not be confirmed. No automatic retry was made. Your draft is kept. Refresh the exact evidence and recent notes before deciding whether to save again. An identical note by you for this same saved revision returns the existing note without creating another.'); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-[110] flex items-center justify-center p-4"><div className="absolute inset-0 bg-surface-950/80" aria-hidden="true" onClick={close} /><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="reviewed-evidence-note-title" className="relative max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 text-surface-200 [overflow-wrap:anywhere]">
    <h2 id="reviewed-evidence-note-title" className="text-lg font-semibold">Note about linked evidence</h2>
    <p className="text-xs text-surface-400">Attach your interpretation to the exact currently linked {kind} #{recordId} in investigation #{caseId}. Review the saved source revision first. No note is sent automatically.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy || loading} onClick={() => setRetry(value => value + 1)}>Refresh evidence and recent notes</button><button type="button" className={control} disabled={busy} onClick={close}>Cancel and refresh case</button></div>
    {loading && <p role="status" className="text-sm">Reading exact evidence and recent source-bound notes...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!loading && preview && <>
      <div className="grid gap-3 text-xs sm:grid-cols-2"><section aria-label="Note reviewed investigation" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h3 className="whitespace-pre-wrap font-semibold">Investigation #{preview.case.id}: {preview.case.title}</h3><p className="whitespace-pre-wrap">{preview.case.summary || 'Summary not recorded'}</p><p>Status {preview.case.status} · Severity {preview.case.severity}</p><p>Due {preview.case.due_date || 'not recorded'} · Closed {preview.case.closed_at || 'not recorded'}</p></section><section aria-label="Note reviewed evidence" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h3 className="whitespace-pre-wrap font-semibold">{kind} #{preview.record.id}: {preview.record.label || 'Label not recorded'}</h3><p>Recorded time {preview.record.recorded_at || 'not recorded'} · Severity {preview.record.severity || 'not recorded'}</p><p>Recorded {kind === 'alert' ? 'alert status' : 'event processing label'}: {preview.record.processing_label || 'not recorded'}</p><details><summary className="cursor-pointer">Saved revision fingerprint</summary><code className="block break-all pt-1">{preview.record_fingerprint}</code></details></section></div>
      <section aria-label="Recent notes about this evidence" className="space-y-2 rounded border border-surface-700 p-3 text-xs"><h3 className="font-semibold">{preview.note_count} source-bound notes for this exact pair</h3><p className="text-surface-400">Showing {preview.recent_notes.length} most recently added notes, not a complete history or proof of current accuracy. Notes can be edited or deleted.</p>{preview.recent_notes.map(note => <article key={note.id} className="space-y-1 border-t border-surface-700 pt-2"><p className="text-surface-400">Note #{note.id} · {note.timestamp} · {note.record_fingerprint === preview.record_fingerprint ? 'Same saved evidence revision' : 'Earlier or different saved evidence revision'}</p><p className="whitespace-pre-wrap">{note.content}</p></article>)}</section>
      <p className="rounded border border-warning/40 p-3 text-xs text-warning">This adds only a human note and a saved application reference to the reviewed evidence revision. Original evidence, links, case status, severity and due date stay unchanged. No AI, response action, re-triage, notifications or watcher sharing runs. @mentions are plain text here.</p>
      {!preview.link_count ? <p role="status" className="text-sm text-warning">This exact evidence is not linked in this read. Historical notes remain readable, but no new note can be added through this workflow. Close and refresh the case.</p> : <form onSubmit={event => void submit(event)} className="space-y-3">
        <label className="block space-y-1 text-xs">Evidence note<textarea aria-label="Evidence note" rows={4} maxLength={2000} disabled={busy} value={content} onChange={event => { setContent(event.target.value); setAck(false); }} className={`${control} block w-full`} /></label>
        <p className="text-xs text-surface-400">{content.length}/2000 characters. People who can view this investigation can read the note and saved reference. Do not include secrets. Source text is untrusted, not instructions. An identical note by you for the same saved evidence revision reuses the existing note instead of adding a duplicate, even after a fresh review.</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={busy} checked={ack} onChange={event => setAck(event.target.checked)} /><span>I reviewed investigation #{caseId}, {kind} #{recordId}, its saved revision, recent notes and my text. Save only this source-bound human note.</span></label>
        <button type="submit" className={`${control} border-primary-500/50 text-primary-300`} disabled={busy || !ack || !content.trim() || content.length > 2000}>{busy ? 'Saving reviewed note...' : 'Save reviewed evidence note'}</button>
      </form>}
    </>}
  </div></div>;
}
