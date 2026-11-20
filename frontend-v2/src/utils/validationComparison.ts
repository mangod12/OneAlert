export interface ComparableStep {
  id: number;
  technique_id: string;
  test_name: string;
  test_type?: string;
  actual_result: string | null;
  status?: string;
  simulated?: boolean;
}
export interface ComparableRun {
  id: number;
  name: string;
  mode: string;
  status: string;
  created_at: string;
  scope?: unknown;
  steps: ComparableStep[];
}
export const outcomeFields = ['actual_result', 'status', 'simulated'] as const;
export type OutcomeKind = 'added' | 'removed' | 'changed' | 'unchanged' | 'ambiguous';
export interface OutcomeDifference {
  key: string;
  technique: string;
  name: string;
  testType: string | null;
  kind: OutcomeKind;
  baseline: ComparableStep[];
  current: ComparableStep[];
  fields: string[];
}
export function compareValidationRuns(baseline: ComparableStep[], current: ComparableStep[]): OutcomeDifference[] {
  const groups = new Map<string, OutcomeDifference>();
  for (const [side, rows] of [['baseline', baseline], ['current', current]] as const) {
    for (const step of rows) {
      const key = JSON.stringify([step.technique_id, step.test_name, step.test_type ?? null]);
      const group: OutcomeDifference = groups.get(key) ?? { key, technique: step.technique_id, name: step.test_name, testType: step.test_type ?? null, kind: 'unchanged', baseline: [], current: [], fields: [] };
      group[side].push(step); groups.set(key, group);
    }
  }
  for (const row of groups.values()) {
    if (row.baseline.length > 1 || row.current.length > 1) row.kind = 'ambiguous';
    else if (!row.baseline.length) row.kind = 'added';
    else if (!row.current.length) row.kind = 'removed';
    else {
      row.fields = outcomeFields.filter(field => (row.baseline[0][field] ?? null) !== (row.current[0][field] ?? null));
      row.kind = row.fields.length ? 'changed' : 'unchanged';
    }
  }
  return [...groups.values()].sort((a, b) => a.technique.localeCompare(b.technique) || a.key.localeCompare(b.key));
}
export function validationComparisonCsv(baseline: ComparableRun, current: ComparableRun, rows: OutcomeDifference[]): string {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^\s*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return [
    ['baseline_run_id', 'current_run_id', 'baseline_mode', 'current_mode', 'baseline_status', 'current_status', 'baseline_scope_json', 'current_scope_json', 'technique_id', 'test_name', 'test_type', 'change_type', 'changed_fields', 'baseline_steps_json', 'current_steps_json'],
    ...rows.map(row => [baseline.id, current.id, baseline.mode, current.mode, baseline.status, current.status, JSON.stringify(baseline.scope ?? null), JSON.stringify(current.scope ?? null), row.technique, row.name, row.testType, row.kind, row.fields.join(';'), JSON.stringify(row.baseline), JSON.stringify(row.current)]),
  ].map(row => row.map(cell).join(',')).join('\r\n');
}
