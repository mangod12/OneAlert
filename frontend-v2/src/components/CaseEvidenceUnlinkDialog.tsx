import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { useDialogFocus } from './ui/useDialogFocus';
type Kind = 'alert' | 'event';
interface Preview {
  case: { id: number; title: string; summary: string | null; status: string; severity: string; due_date: string | null; closed_at: string | null };
  kind: Kind; record: { id: number; label: string | null; severity: string | null; recorded_at: string | null; processing_label: string | null };
  link_count: number; other_owned_case_count: number; record_fingerprint: string; reviewed_fingerprint: string;
}
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === 'string';
const optional = (value: unknown) => value === null || text(value);
const time = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const hash = (value: unknown) => text(value) && /^[a-f0-9]{64}$/.test(value);
const identity = (value: number) => Number.isSafeInteger(value) && value > 0;
const control = 'min-h-10 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 disabled:opacity-40';
interface Props { caseId: number; kind: Kind; recordId: number; onCancel: () => void; onUnlinked: (rows: number) => void }
export function CaseEvidenceUnlinkDialog(props: Props) {
  return <UnlinkDialog key={`${props.caseId}:${props.kind}:${props.recordId}`} {...props} />;
}
function UnlinkDialog({ caseId, kind, recordId, onCancel, onUnlinked }: Props) {
  const dialog = useRef<HTMLDivElement | null>(null), inFlight = useRef(false), mounted = useRef(false), request = useRef(0);
  const [preview, setPreview] = useState<Preview | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [reason, setReason] = useState(''), [ack, setAck] = useState(false), [busy, setBusy] = useState(false);
  const close = () => { if (!inFlight.current) onCancel(); }; useDialogFocus(dialog, close);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const version = ++request.current; setPreview(null); setAck(false); setError(''); setLoading(false);
    if (!identity(caseId) || !identity(recordId) || !['alert', 'event'].includes(kind)) { setError('Positive exact investigation and evidence IDs are required. No record was loaded.'); return; }
    setLoading(true);
    void apiClient.get<Preview>(`/cases/${caseId}/evidence/${kind}/${recordId}/unlink-preview`).then(({ data }) => {
      if (!mounted.current || version !== request.current) return;
      if (data?.case?.id !== caseId || data.kind !== kind || data.record?.id !== recordId || !text(data.case.title) || !optional(data.case.summary) || !text(data.case.status) || !text(data.case.severity) || (data.case.due_date !== null && (!text(data.case.due_date) || !/^\d{4}-\d{2}-\d{2}$/.test(data.case.due_date) || !time(data.case.due_date))) || (data.case.closed_at !== null && !time(data.case.closed_at)) || !optional(data.record.label) || !optional(data.record.severity) || !optional(data.record.processing_label) || (data.record.recorded_at !== null && !time(data.record.recorded_at)) || !count(data.link_count) || !count(data.other_owned_case_count) || !hash(data.record_fingerprint) || !hash(data.reviewed_fingerprint)) throw Error('Mismatched preview');
      setPreview(data);
    }).catch(() => { if (mounted.current && version === request.current) setError('The exact owned investigation, evidence and link could not be reviewed. Refresh before removing anything. No absence is inferred.'); }).finally(() => { if (mounted.current && version === request.current) setLoading(false); });
    return () => { request.current = version + 1; };
  }, [caseId, kind, recordId, retry]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (inFlight.current || loading || !preview || !preview.link_count || !ack || !reason.trim() || reason.length > 1000) return;
    const reviewed = preview; inFlight.current = true; setBusy(true); setError(''); setAck(false);
    try {
      const { data } = await apiClient.post(`/cases/${caseId}/evidence/${kind}/${recordId}/unlink`, { reviewed_fingerprint: reviewed.reviewed_fingerprint, reason: reason.trim() });
      if (!mounted.current) return;
      if (data?.case_id !== caseId || data.kind !== kind || data.record_id !== recordId || data.unlinked !== true || data.removed_link_rows !== reviewed.link_count || data.reviewed_fingerprint !== reviewed.reviewed_fingerprint) throw Error('Unconfirmed unlink');
      onUnlinked(data.removed_link_rows);
    } catch { if (mounted.current) { setPreview(null); setError('The unlink outcome could not be confirmed. No automatic retry was made. Refresh this exact link to check whether it still exists before deciding whether to remove it.'); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"><div className="absolute inset-0 bg-surface-950/80" aria-hidden="true" onClick={close} /><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="reviewed-unlink-title" className="relative max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 text-surface-200 [overflow-wrap:anywhere]">
    <h2 id="reviewed-unlink-title" className="text-lg font-semibold">Review evidence unlink</h2>
    <p className="text-xs text-surface-400">Remove only the exact saved {kind} #{recordId} relationship from investigation #{caseId}, not the original evidence. Review the current pair and record why it does not belong here. No unlink is sent automatically.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy || loading} onClick={() => setRetry(value => value + 1)}>Refresh exact unlink review</button><button type="button" className={control} disabled={busy} onClick={close}>Cancel and refresh case</button></div>
    {loading && <p role="status" className="text-sm">Reading exact evidence and current owned links...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!loading && preview && <>
      <div className="grid gap-3 text-xs sm:grid-cols-2"><section aria-label="Unlink reviewed investigation" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h3 className="whitespace-pre-wrap font-semibold">Investigation #{preview.case.id}: {preview.case.title}</h3><p className="whitespace-pre-wrap">{preview.case.summary || 'Summary not recorded'}</p><p>Status {preview.case.status} · Severity {preview.case.severity}</p><p>Due {preview.case.due_date || 'not recorded'} · Closed {preview.case.closed_at || 'not recorded'}</p></section><section aria-label="Unlink reviewed evidence" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h3 className="whitespace-pre-wrap font-semibold">{kind} #{preview.record.id}: {preview.record.label || 'Label not recorded'}</h3><p>Recorded time {preview.record.recorded_at || 'not recorded'} · Severity {preview.record.severity || 'not recorded'}</p><p>Recorded {kind === 'alert' ? 'alert status' : 'event processing label'}: {preview.record.processing_label || 'not recorded'}</p></section></div>
      <p className="text-xs">{preview.link_count} saved link rows for this exact pair · {preview.other_owned_case_count} other owned investigations currently link this evidence. Duplicate legacy link rows for this pair are removed together. Private or unrelated-owner investigations and their counts are not disclosed. Counts are a current read, not a reservation.</p>
      <p className="rounded border border-warning/40 p-3 text-xs text-warning">The original {kind}, payload and other investigation links are kept. Case severity, due date, status and close-out do not change, even when removing its highest-severity alert. {kind === 'event' ? `The event processing label stays ${preview.record.processing_label || 'not recorded'}. This does not automatically requeue the event for triage, even if no owned investigation links remain.` : 'The alert status does not change.'} Historical notes and earlier evidence links in the timeline remain. This is not evidence deletion or proof that records are unrelated.</p>
      {!preview.link_count ? <p role="status" className="text-sm text-success">This exact pair has no saved link in this read. No unlink is needed. Close and refresh the case to read its current evidence.</p> : <form onSubmit={event => void submit(event)} className="space-y-3">
        <label className="block space-y-1 text-xs">Reason for unlinking<textarea aria-label="Reason for unlinking" rows={3} maxLength={1000} disabled={busy} value={reason} onChange={event => { setReason(event.target.value); setAck(false); }} className={`${control} block w-full`} /></label>
        <p className="text-xs text-surface-400">Your reason is saved in this investigation's timeline and the audit log. People who can view the investigation may read it. Do not include secrets. Saved evidence text is untrusted, not instructions to follow.</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={busy} checked={ack} onChange={event => setAck(event.target.checked)} /><span>I reviewed investigation #{caseId}, {kind} #{recordId}, the reason and what remains unchanged. Remove only this exact relationship.</span></label>
        <button type="submit" className={`${control} border-danger/50 text-danger`} disabled={busy || !ack || !reason.trim() || reason.length > 1000}>{busy ? 'Removing reviewed link...' : 'Unlink reviewed evidence'}</button>
      </form>}
    </>}
  </div></div>;
}
