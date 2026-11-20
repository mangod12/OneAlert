interface Control { id: number; control_name: string; control_type: string; expected: boolean; detected: boolean; detection_time_ms: number | null; details: string | null; }
interface Step { id: number; technique_id: string; test_name: string; actual_result: string | null; duration_ms: number | null; simulated?: boolean; status?: string; test_type?: string; executed_at?: string | null; controls?: Control[]; }
function cell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  let start = 0;
  while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/u.test(raw[start]))) start++;
  const safe = '=+@-'.includes(raw[start] ?? '\uffff') ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function validationEvidenceCsv(run: { id: number; name: string; mode: string }, steps: Step[], filter: string, search: string): string {
  const rows: unknown[][] = [['run_id', 'run_name', 'run_mode', 'step_id', 'technique_id', 'test_name', 'recorded_result', 'recorded_status', 'simulated', 'test_type', 'duration_ms', 'executed_at', 'control_id', 'control_name', 'control_type', 'expected_detection', 'recorded_detection', 'detection_time_ms', 'control_detail', 'scope_result_filter', 'scope_search', 'evidence_scope']];
  for (const step of steps) for (const control of step.controls?.length ? step.controls : [null]) rows.push([run.id, run.name, run.mode, step.id, step.technique_id, step.test_name, step.actual_result ?? 'not recorded', step.status, step.simulated === undefined ? 'unknown' : step.simulated, step.test_type, step.duration_ms, step.executed_at, control?.id, control?.control_name, control?.control_type, control?.expected, control?.detected, control?.detection_time_ms, control?.details, filter, search, 'loaded saved validation evidence; simulated results do not prove live detection; blank controls are not recorded']);
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
