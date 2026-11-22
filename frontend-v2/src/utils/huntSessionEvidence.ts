import type { HuntEvidenceResult } from './huntEvidence';
import type { HuntQueryResult } from '../components/HuntQueryEvidence';
export interface SavedHuntSession { retained_evidence_fingerprint?: string | null; id: number; hypothesis: string; status: string; queries_run: number; findings_count: number; created_at: string; result_data: HuntEvidenceResult | HuntQueryResult[] | null; sigma_rule: string | null; }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
export function savedHuntEvidence(value: unknown, id: number): { session: SavedHuntSession; evidence: HuntEvidenceResult } {
  if (!object(value) || value.id !== id || ['hypothesis','status','created_at'].some(key => typeof value[key] !== 'string') || ['queries_run','findings_count'].some(key => !Number.isSafeInteger(value[key]) || (value[key] as number) < 0) || (value.sigma_rule !== null && typeof value.sigma_rule !== 'string')) throw Error('The hunt session response did not match this exact saved record.');
  const raw = value.result_data;
  if (value.retained_evidence_fingerprint !== undefined && value.retained_evidence_fingerprint !== null && (typeof value.retained_evidence_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.retained_evidence_fingerprint))) throw Error('Saved hunt review fingerprint is unsupported. Refresh saved evidence.');
  if (raw !== null && !Array.isArray(raw) && !object(raw)) throw Error('Saved hunt evidence has an unsupported format. No results were inferred.');
  const evidence = (Array.isArray(raw) ? { query_results: raw } : raw ?? {}) as HuntEvidenceResult;
  if (['explanation','error','summary','recorded_at','status','sigma_rule'].some(key => !optionalText((evidence as Record<string, unknown>)[key]))) throw Error('Saved hunt metadata is malformed. No results were inferred.');
  if (evidence.execution_summary && (!object(evidence.execution_summary) || ['completed','rejected','failed','attempted','skipped'].some(key => !Number.isSafeInteger((evidence.execution_summary as unknown as Record<string, unknown>)[key]) || ((evidence.execution_summary as unknown as Record<string, number>)[key] < 0)))) throw Error('Saved hunt execution counts are malformed.');
  if (evidence.query_results !== undefined && (!Array.isArray(evidence.query_results) || evidence.query_results.some(result => {
    if (!object(result) || !optionalText(result.error) || (result.outcome !== undefined && !['completed','rejected','failed'].includes(String(result.outcome)))) return true;
    if (result.rows !== undefined && (!Array.isArray(result.rows) || result.rows.some(row => !object(row)))) return true;
    if (result.row_count !== undefined && (!Number.isSafeInteger(result.row_count) || (result.row_count as number) < 0)) return true;
    if (result.query !== undefined && (!object(result.query) || !optionalText(result.query.description) || !optionalText(result.query.sql) || (result.query.params !== undefined && !object(result.query.params)))) return true;
    if (result.time_window !== undefined && (!object(result.time_window) || !optionalText(result.time_window.since) || !optionalText(result.time_window.before))) return true;
    if (result.execution !== undefined && (!object(result.execution) || ['contract','order_by','direction'].some(key => typeof (result.execution as Record<string, unknown>)[key] !== 'string') || !Array.isArray(result.execution.selected_columns) || result.execution.selected_columns.some(column => typeof column !== 'string') || !Number.isSafeInteger(result.execution.row_limit) || (result.execution.tie_breaker != null && (!object(result.execution.tie_breaker) || typeof result.execution.tie_breaker.column !== 'string' || typeof result.execution.tie_breaker.direction !== 'string')))) return true;
    return false;
  }))) throw Error('Saved query evidence is malformed. No results were inferred.');
  return { session: value as unknown as SavedHuntSession, evidence: { ...evidence, session_id: id, hypothesis: value.hypothesis as string, sigma_rule: value.sigma_rule as string ?? evidence.sigma_rule } };
}
