export interface ComparisonStep { id: number; step_number: number; action: string; input_summary: string | null; output_summary: string | null; tool_used: string | null; duration_ms: number | null }
export interface ComparisonRun { id: number; agent_type: string; status: string; started_at: string; completed_at: string | null; model_used: string | null; prompt_tokens: number; completion_tokens: number; result_summary: string | null; error_message: string | null; steps: ComparisonStep[] }
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value: unknown) => value === null || typeof value === 'string';
export function validateComparisonRun(value: unknown, id: number): ComparisonRun {
  const run = value as ComparisonRun;
  if (!run || run.id !== id || !count(run.id) || run.id < 1 || typeof run.agent_type !== 'string' || typeof run.status !== 'string' || !timestamp(run.started_at) || (run.completed_at !== null && !timestamp(run.completed_at)) || !text(run.model_used) || !text(run.result_summary) || !text(run.error_message) || !count(run.prompt_tokens) || !count(run.completion_tokens) || !Array.isArray(run.steps) || run.steps.length > 5000 || new Set(run.steps.map(step => step?.id)).size !== run.steps.length || run.steps.some(step => !step || !count(step.id) || step.id < 1 || !count(step.step_number) || typeof step.action !== 'string' || !text(step.tool_used) || !text(step.input_summary) || !text(step.output_summary) || (step.duration_ms !== null && !count(step.duration_ms)))) throw Error('Run comparison requires matching run IDs and complete valid saved steps, up to 5,000 per run. No partial comparison is shown.');
  const { id: runId, agent_type, status, started_at, completed_at, model_used, prompt_tokens, completion_tokens, result_summary, error_message } = run;
  return { id: runId, agent_type, status, started_at, completed_at, model_used, prompt_tokens, completion_tokens, result_summary, error_message, steps: run.steps.map(({ id, step_number, action, tool_used, input_summary, output_summary, duration_ms }) => ({ id, step_number, action, tool_used, input_summary, output_summary, duration_ms })) };
}
export function recordedElapsed(run: ComparisonRun): number | null {
  if (run.completed_at === null) return null;
  const duration = Date.parse(run.completed_at) - Date.parse(run.started_at);
  return duration < 0 ? null : duration;
}
export interface StepGroup { signature: [string, string | null, string | null, string | null]; baseline: ComparisonStep[]; candidate: ComparisonStep[]; shared: number; baseline_only: number; candidate_only: number }
export function compareRecordedRuns(baseline: ComparisonRun, candidate: ComparisonRun) {
  if (baseline.id === candidate.id) throw Error('Choose two different recorded runs.');
  const groups = new Map<string, StepGroup>();
  for (const [side, run] of [['baseline', baseline], ['candidate', candidate]] as const) {
    for (const step of [...run.steps].sort((a, b) => a.step_number - b.step_number || a.id - b.id)) {
      const signature: StepGroup['signature'] = [step.action, step.tool_used, step.input_summary, step.output_summary];
      const key = JSON.stringify(signature);
      if (!groups.has(key)) groups.set(key, { signature, baseline: [], candidate: [], shared: 0, baseline_only: 0, candidate_only: 0 });
      groups.get(key)![side].push(step);
    }
  }
  for (const group of groups.values()) {
    group.shared = Math.min(group.baseline.length, group.candidate.length);
    group.baseline_only = group.baseline.length - group.shared;
    group.candidate_only = group.candidate.length - group.shared;
  }
  return { groups: [...groups.values()], shared: [...groups.values()].reduce((sum, group) => sum + group.shared, 0), baseline_only: [...groups.values()].reduce((sum, group) => sum + group.baseline_only, 0), candidate_only: [...groups.values()].reduce((sum, group) => sum + group.candidate_only, 0) };
}
export const comparisonScope = 'Two separately requested current owned-run reads, not an atomic snapshot, evaluation score, same-input replay or verified outcome. Exact step-content equality uses action, tool and recorded input/output summaries, preserving duplicates, nulls, empty strings and case. IDs, order and durations are excluded from content identity; original records remain included. Summaries may already be shortened and running runs incomplete. Recorded labels, statuses and token/time differences do not establish quality, cost or successful external activity. No agent is run and no state or access changes. Sensitive saved text must be reviewed before sharing; downloaded copies have no application access controls.';
