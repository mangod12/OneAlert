import { parseHuntQueryDraft } from './huntQueryDraft';

export function draftSourceFixture() {
  const source = parseHuntQueryDraft({
    session_id: 7, hypothesis: 'Inspect owned event metadata', fingerprint: 'a'.repeat(64), agent_run_id: 9,
    read_at: '2026-11-22T03:10:00Z', can_execute: true, scope: 'Saved compiler review only',
    draft: {
      format: 'onealert_hunt_query_draft_v1', prepared_at: '2026-11-22T03:00:00Z', expires_at: '2026-11-22T04:00:00Z',
      generation_method: 'provider_response', generated_query_count: 1, omitted_query_count: 0,
      explanation: 'Recorded proposal, not an incident conclusion', explanation_shortened: false, scope: 'No event SELECT',
      queries: [{
        position: 1, description: 'Recorded query description', description_shortened: false,
        sql: 'SELECT id FROM security_events WHERE user_id = :user_id AND timestamp >= :since AND timestamp < :before ORDER BY id ASC LIMIT 100',
        params: { since: '2026-11-20T00:00:00Z', before: '2026-11-22T00:00:00Z' }, accepted: true, error: null,
        time_window: { since: '2026-11-20T00:00:00+00:00', before: '2026-11-22T00:00:00+00:00' },
        execution: { contract: 'scoped_select_v1', selected_columns: ['id'], order_by: 'id', direction: 'ASC', row_limit: 100, requested_limit: 100, tie_breaker: null },
      }],
    },
  });
  const refined = structuredClone(source);
  refined.session_id = 8; refined.fingerprint = 'b'.repeat(64); refined.agent_run_id = 10;
  refined.draft.generation_method = 'analyst_refinement';
  refined.draft.refinement = { source_session_id: 7, source_fingerprint: source.fingerprint, source_prepared_at: source.draft.prepared_at, source_omitted_query_count: 0, edited_query_numbers: [1], scope: 'New compiler-only draft, no execution.' };
  refined.draft.queries[0] = {
    ...refined.draft.queries[0],
    sql: 'SELECT id FROM security_events WHERE user_id = :user_id AND timestamp < :before ORDER BY id ASC LIMIT 20',
    params: { before: '2026-11-23T00:00:00Z' }, time_window: { before: '2026-11-23T00:00:00+00:00' },
    execution: { ...refined.draft.queries[0].execution!, requested_limit: 20, row_limit: 20 },
  };
  return { source, refined };
}
