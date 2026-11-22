import { reviewedAuditFixture } from './huntReviewedExecutionAudit.fixture';
import type { HuntEvidenceResult } from './huntEvidence';
export function exactDraftExecutionFixture() {
  const { source, result } = reviewedAuditFixture();
  const saved = (id: number, data: HuntEvidenceResult) => ({ id, hypothesis: source.hypothesis, status: data.status!, queries_run: data.execution_summary?.attempted ?? 0, findings_count: data.query_results?.reduce((sum, query) => sum + (query.row_count ?? 0), 0) ?? 0, created_at: '2026-11-22T03:15:00Z', sigma_rule: null, result_data: { ...data, session_id: id } });
  return { source, left: saved(81, result), right: saved(82, structuredClone(result)), saved, result };
}
