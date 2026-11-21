import { describe, expect, it } from 'vitest';
import { compareRecordedRuns, recordedElapsed, validateComparisonRun, type ComparisonRun, type ComparisonStep } from './compareRecordedRuns';
const step = (id: number, extra = {}): ComparisonStep => ({ id, step_number: id, action: 'search', tool_used: null, input_summary: 'input', output_summary: 'output', duration_ms: null, ...extra });
const run = (id: number, steps: ComparisonStep[] = []): ComparisonRun => ({ id, agent_type: 'hunt', status: 'completed', started_at: '2026-11-22T00:00:00Z', completed_at: '2026-11-22T00:00:00Z', model_used: null, prompt_tokens: 0, completion_tokens: 0, result_summary: null, error_message: null, steps });
it('preserves duplicate occurrences instead of collapsing content into sets', () => {
  const result = compareRecordedRuns(run(1, [step(11), step(12), step(13)]), run(2, [step(21), step(22)]));
  expect(result.shared).toBe(2); expect(result.baseline_only).toBe(1); expect(result.candidate_only).toBe(0);
  expect(result.groups[0].baseline.map(row => row.id)).toEqual([11, 12, 13]);
});
it('excludes IDs/order/duration from identity but preserves all original source fields', () => {
  const result = compareRecordedRuns(run(1, [step(11, { step_number: 4, duration_ms: 0 })]), run(2, [step(21, { step_number: 90, duration_ms: 100 })]));
  expect(result.shared).toBe(1); expect(result.groups[0].baseline[0].duration_ms).toBe(0); expect(result.groups[0].candidate[0].step_number).toBe(90);
});
it('distinguishes null, empty, case, field boundaries and literal special text', () => {
  const values = [step(1), step(2, { tool_used: '' }), step(3, { input_summary: 'INPUT' }), step(4, { input_summary: 'in|put', output_summary: 'out' }), step(5, { input_summary: 'in', output_summary: 'put|out' }), step(6, { input_summary: '"<script>_% 🥭' })];
  expect(compareRecordedRuns(run(1, values), run(2)).groups).toHaveLength(6);
});
it('handles empty and different-agent runs without inferring success', () => {
  expect(compareRecordedRuns(run(1), { ...run(2), agent_type: 'triage', status: 'failed' })).toEqual({ groups: [], shared: 0, baseline_only: 0, candidate_only: 0 });
  expect(() => compareRecordedRuns(run(1), run(1))).toThrow('different');
});
it('keeps zero elapsed distinct from absent and invalid intervals', () => {
  expect(recordedElapsed(run(1))).toBe(0);
  expect(recordedElapsed({ ...run(1), completed_at: null })).toBeNull();
  expect(recordedElapsed({ ...run(1), completed_at: '2026-11-21T23:59:59Z' })).toBeNull();
});
describe('fail-closed source validation', () => {
  it('accepts zero tokens, empty strings, zero step numbers and nulls', () => {
    const source = { ...run(1, [step(1, { step_number: 0, duration_ms: 0 })]), result_summary: '', model_used: '' };
    expect(validateComparisonRun(source, 1)).toEqual(source);
  });
  it.each([null, {}, { ...run(1), id: 2 }, { ...run(1), prompt_tokens: -1 }, { ...run(1), started_at: 'invalid' }, { ...run(1), steps: [step(1), step(1)] }, { ...run(1), steps: [step(1, { duration_ms: -1 })] }, { ...run(1), steps: [step(1, { output_summary: {} })] }, { ...run(1), steps: [step(1, { id: 1.5 })] }, { ...run(1), steps: Array.from({ length: 5001 }, (_, i) => step(i + 1)) }])('rejects malformed or partial source %#', value => {
    expect(() => validateComparisonRun(value, 1)).toThrow('No partial comparison');
  });
});

it('whitelists comparison evidence fields rather than forwarding future server internals', () => {
  const result = validateComparisonRun({ ...run(1, [{ ...step(1), internal_value: 'private' } as ComparisonStep]), user_id: 99, internal_value: 'private' }, 1);
  expect(result).not.toHaveProperty('user_id'); expect(result).not.toHaveProperty('internal_value'); expect(result.steps[0]).not.toHaveProperty('internal_value');
});
