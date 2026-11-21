import { verifySavedBriefing, type Source } from './caseBriefingEvidence';
type Scope = { linked: number; available: number; included: number; omitted: number; unavailable: number; limit: number };
export interface BriefingInputs { format: string; version: number; case_id: number; retrieved_at: string; source_records: Source[]; scope: { alert: Scope; event: Scope }; excluded: string }
export function verifyBriefingInputs(value: BriefingInputs, caseId: number) {
  if (!value || value.format !== 'onealert-briefing-inputs' || value.version !== 1 || value.case_id !== caseId
    || typeof value.excluded !== 'string' || !Array.isArray(value.source_records)
    || value.scope?.alert?.limit !== 20 || value.scope?.event?.limit !== 50
    || new Set(value.source_records.map(s => s?.key)).size !== value.source_records.length) return false;
  return verifySavedBriefing({ timeline_id: 1, briefing: { format: 'onealert-case-briefing', version: 1, case_id: caseId,
    run_id: 1, mode: 'ai_draft', captured_at: value.retrieved_at, scope: value.scope, sources: value.source_records,
    observations: [{ text: 'Input preview only, no draft generated.', sources: [`case:${caseId}`] }], gaps: [], review_questions: [] } }, caseId);
}
