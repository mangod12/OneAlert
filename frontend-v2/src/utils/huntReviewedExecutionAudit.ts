import { isReviewedHuntOrigin, parseHuntQueryDraft, parseReviewedHuntResult, type DraftQuery, type HuntQueryDraft } from './huntQueryDraft';
import type { HuntEvidenceResult } from './huntEvidence';
import type { HuntQueryResult } from '../components/HuntQueryEvidence';

export interface ReviewedHuntExecutionAudit {
  source: HuntQueryDraft;
  result: HuntEvidenceResult;
  completeReceipt: boolean;
  queries: { originalPosition: number; source: DraftQuery; result: HuntQueryResult | null }[];
}
export function reviewedExecutionSourceId(result: HuntEvidenceResult): number {
  if (!isReviewedHuntOrigin(result.reviewed_draft) || !Number.isSafeInteger(result.session_id) || Number(result.session_id) < 1 || result.session_id === result.reviewed_draft.session_id) throw Error('This saved result has no supported distinct reviewed-draft source receipt. No source was inferred.');
  return result.reviewed_draft.session_id;
}
export function auditReviewedHuntExecution(result: HuntEvidenceResult, sourceValue: unknown): ReviewedHuntExecutionAudit {
  const source = parseHuntQueryDraft(sourceValue, { id: reviewedExecutionSourceId(result) });
  if (source.fingerprint !== result.reviewed_draft!.fingerprint || source.hypothesis !== result.hypothesis) throw Error('The recorded draft identity, fingerprint or hypothesis no longer matches this saved execution receipt. No replacement source was used.');
  const checked = parseReviewedHuntResult(result, source, result.reviewed_draft!.query_numbers);
  const completeReceipt = checked.query_results !== undefined && checked.execution_summary !== undefined;
  return { source, result: checked, completeReceipt, queries: checked.reviewed_draft!.query_numbers.map((originalPosition, index) => ({ originalPosition, source: source.draft.queries[originalPosition - 1], result: completeReceipt ? checked.query_results![index] : null })) };
}
export function reviewedHuntExecutionAuditJson(value: ReviewedHuntExecutionAudit, resultReadAt: string, exportedAt: string): string {
  if (![resultReadAt, exportedAt].every(value => Number.isFinite(Date.parse(value)))) throw Error('Valid loaded-result and export times are required.');
  const checked = auditReviewedHuntExecution(value.result, value.source);
  return JSON.stringify({ format: 'onealert_reviewed_hunt_execution_audit_v1', result_read_at: resultReadAt, exported_at: exportedAt, ...checked,
    scope: 'Loaded saved execution and its exact recorded compiler draft. Source fingerprint and selected query receipts are checked where complete receipts were retained. An interrupted run with no complete receipt is not a zero-finding result. Reads are not atomic. This is not a cryptographic integrity proof, live event verification, threat conclusion or execution approval. No query, AI call, source renewal or extra read occurs during export. Includes retained telemetry, hypothesis, SQL and parameters. Keep private; downloaded copies have no application access controls. Unretained rows and omitted generated queries are not recovered.' }, null, 2) + '\n';
}
