import type { DraftExecutionPage } from './huntDraftExecutions';
import { draftSourceFixture } from './huntDraftSourceComparison.fixture';
export function draftExecutionPageFixture(offset = 0, total = 21) {
  const { source } = draftSourceFixture();
  const page: DraftExecutionPage = {
    source_session_id: source.session_id, source_fingerprint: source.fingerprint,
    read_at: '2026-11-22T05:40:00Z', offset, limit: 10, total,
    executions: Array.from({ length: Math.min(10, Math.max(0, total - offset)) }, (_, index) => ({
      session_id: 100 - offset - index, status: index === 1 ? 'failed' : 'completed',
      created_at: '2026-11-22T05:30:00', receipt_supported: index !== 2,
      query_numbers: index === 2 ? null : [1], agent_run_id: index === 1 ? null : 91,
      recorded_queries_run: index === 1 ? 0 : 1, recorded_row_count: index === 1 ? 0 : 2,
    })), scope: 'Saved exact-source receipt metadata, not complete query-result verification.',
  };
  return { source, page };
}
