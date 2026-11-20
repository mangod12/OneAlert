import { expect, it } from 'vitest';
import { responseActionCsv } from './responseActionCsv';
const plan = { id: 1, case_id: 2, status: 'partial', autonomy_level: 'L2', actions: [{ action_type: 'isolate_host', target: 'host', reason: 'review' }] };
it('distinguishes missing evidence from a false policy decision and preserves zero priority', () => {
  const csv = responseActionCsv({ ...plan, actions: [...plan.actions, { ...plan.actions[0], priority: 0, policy_check: { approved: false }, execution_result: { status: 'failed', detail: 'Stored, "detail"\nline2', executed_at: '2026-11-20T08:00:00Z' } }] });
  expect(csv).toContain('"unknown","not recorded"');
  expect(csv).toContain('"2","0","isolate_host"');
  expect(csv).toContain('"false","failed","Stored, ""detail""\nline2","2026-11-20T08:00:00Z"');
});
it.each(['=SUM(1)', '+cmd', '-cmd', '@cmd', '\t =1', '\r@cmd'])('neutralizes formula-like action text %j', value => {
  const csv = responseActionCsv({ ...plan, actions: [{ action_type: value, target: value, reason: value, execution_result: { detail: value } }] });
  expect(csv.split(`"'${value}"`)).toHaveLength(5);
});
it('exports explicit simulation mode and never infers it for historical results', () => {
  const csv = responseActionCsv({ ...plan, actions: [
    { ...plan.actions[0], execution_result: { status: 'completed', execution_mode: 'simulated' } },
    { ...plan.actions[0], execution_result: { status: 'completed' } },
    { ...plan.actions[0], execution_result: { status: 'completed', execution_mode: 'live' } },
  ] });
  expect(csv).toContain('"recorded_execution_mode"');
  expect(csv.match(/"simulated"/g)).toHaveLength(1);
  expect(csv.match(/"unknown","loaded saved/g)).toHaveLength(2);
});

it('exports structured legacy values as JSON and does not label a truthy string approved', () => {
  const legacy = { toString: 'recorded-data' };
  const input = { ...plan, actions: [{ action_type: legacy, target: legacy, reason: legacy, policy_check: { approved: 'false' } }] };
  const csv = responseActionCsv(input as unknown as Parameters<typeof responseActionCsv>[0]);
  expect(csv).toContain('{""toString"":""recorded-data""}');
  expect(csv).toContain('"unknown","not recorded"');
});
