export type EvidenceNoteReferenceData = { kind: 'alert' | 'event'; id: number; fingerprint: string; label: string; truncated: boolean; severity: string | null; recordedAt: string | null; processing: string | null };
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const optional = (value: unknown): value is string | null => value === null || typeof value === 'string';
export function parseEvidenceNoteReference(metadata: unknown, caseId: number): EvidenceNoteReferenceData | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  if (m.kind !== 'reviewed_evidence_note' || m.schema_version !== 1 || m.case_id !== caseId || (m.record_kind !== 'alert' && m.record_kind !== 'event') || !Number.isSafeInteger(m.record_id) || Number(m.record_id) <= 0 || !hash(m.record_fingerprint) || !hash(m.reviewed_fingerprint) || !m.record_snapshot || typeof m.record_snapshot !== 'object') return null;
  const s = m.record_snapshot as Record<string, unknown>;
  if (typeof s.label_at_review !== 'string' || s.label_at_review.length > 500 || typeof s.label_truncated !== 'boolean' || !optional(s.severity) || !optional(s.processing_label) || !optional(s.recorded_at) || (s.recorded_at !== null && !Number.isFinite(Date.parse(s.recorded_at)))) return null;
  return { kind: m.record_kind as EvidenceNoteReferenceData['kind'], id: Number(m.record_id), fingerprint: m.record_fingerprint, label: s.label_at_review, truncated: s.label_truncated, severity: s.severity, recordedAt: s.recorded_at, processing: s.processing_label };
}
