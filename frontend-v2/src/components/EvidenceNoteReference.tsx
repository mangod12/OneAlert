import { EvidenceNoteSourceComparison } from './EvidenceNoteSourceComparison';
type Reference = { kind: 'alert' | 'event'; id: number; fingerprint: string; label: string; truncated: boolean; severity: string | null; recordedAt: string | null; processing: string | null };
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const optional = (value: unknown): value is string | null => value === null || typeof value === 'string';
function parse(metadata: unknown, caseId: number): Reference | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  if (m.kind !== 'reviewed_evidence_note' || m.schema_version !== 1 || m.case_id !== caseId || !['alert', 'event'].includes(String(m.record_kind)) || !Number.isSafeInteger(m.record_id) || Number(m.record_id) <= 0 || !hash(m.record_fingerprint) || !hash(m.reviewed_fingerprint) || !m.record_snapshot || typeof m.record_snapshot !== 'object') return null;
  const s = m.record_snapshot as Record<string, unknown>;
  if (typeof s.label_at_review !== 'string' || s.label_at_review.length > 500 || typeof s.label_truncated !== 'boolean' || !optional(s.severity) || !optional(s.processing_label) || !optional(s.recorded_at) || (s.recorded_at !== null && !Number.isFinite(Date.parse(s.recorded_at)))) return null;
  return { kind: m.record_kind as Reference['kind'], id: Number(m.record_id), fingerprint: m.record_fingerprint, label: s.label_at_review, truncated: s.label_truncated, severity: s.severity, recordedAt: s.recorded_at, processing: s.processing_label };
}
export function EvidenceNoteReference({ metadata, caseId, canOpenOriginal, noteId }: { metadata: unknown; caseId: number; canOpenOriginal: boolean; noteId?: number }) {
  const reference = parse(metadata, caseId);
  if (!reference) {
    if (metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>).kind === 'reviewed_evidence_note') return <p className="mt-2 text-xs text-warning">Saved evidence reference could not be verified. No current evidence or link is inferred.</p>;
    return null;
  }
  return <details className="mt-2 min-w-0 rounded border border-primary-500/25 bg-primary-500/5 p-3 text-xs [overflow-wrap:anywhere]"><summary className="cursor-pointer text-primary-300">Saved source reference: {reference.kind} #{reference.id}</summary><div className="space-y-2 pt-3"><p className="whitespace-pre-wrap">{reference.label || 'Source label not recorded'}{reference.truncated ? ' [saved label excerpt, truncated at 500 characters]' : ''}</p><p>At first review: severity {reference.severity || 'not recorded'} · recorded time {reference.recordedAt || 'not recorded'} · {reference.kind === 'event' ? 'processing label' : 'alert status'} {reference.processing || 'not recorded'}</p><p>Saved evidence revision fingerprint</p><code className="block break-all text-surface-400">{reference.fingerprint}</code><p className="text-surface-400">This is a saved application snapshot, not signed or tamper-proof evidence. Source fields or links may have changed or disappeared. Editing this note does not re-review its original source reference. This note can be edited or deleted.</p>{canOpenOriginal && <a className="inline-flex min-h-9 items-center text-primary-300 underline" href={reference.kind === 'alert' ? `/app/alerts?alert=${reference.id}` : `/app/events/${reference.id}`}>Open current original {reference.kind} #{reference.id}, access checked separately</a>}{canOpenOriginal && Number.isSafeInteger(noteId) && Number(noteId) > 0 && <EvidenceNoteSourceComparison caseId={caseId} noteId={Number(noteId)} kind={reference.kind} recordId={reference.id} savedFingerprint={reference.fingerprint} savedSnapshot={{ label_at_review: reference.label, label_truncated: reference.truncated, severity: reference.severity, recorded_at: reference.recordedAt, processing_label: reference.processing }} />}</div></details>;
}
