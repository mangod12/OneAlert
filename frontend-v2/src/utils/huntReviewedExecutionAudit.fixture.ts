import { draftSourceFixture } from './huntDraftSourceComparison.fixture';
import type { HuntEvidenceResult } from './huntEvidence';
export function reviewedAuditFixture() {
  const { source } = draftSourceFixture();
  source.draft.queries = [1, 2, 3].map(position => ({ ...structuredClone(source.draft.queries[0]), position, description: `Original query ${position}` }));
  source.draft.generated_query_count = 5; source.draft.omitted_query_count = 2;
  const query = source.draft.queries[1];
  const result: HuntEvidenceResult = {
    session_id: 81, agent_run_id: 91, hypothesis: source.hypothesis, status: 'completed', recorded_at: '2026-11-22T03:15:00Z',
    reviewed_draft: { session_id: source.session_id, fingerprint: source.fingerprint, query_numbers: [2], scope: 'Selected saved queries only' },
    execution_summary: { completed: 1, rejected: 0, failed: 0, attempted: 1, skipped: 0 },
    query_results: [{ outcome: 'completed', query: { description: query.description, sql: query.sql!, params: { ...query.params }, reviewed_query_number: 2 }, execution: structuredClone(query.execution!), time_window: { ...query.time_window }, row_count: 1, rows: [{ id: 22 }] }],
  };
  return { source, result };
}
