interface Action { priority?: number; action_type: string; target: string; reason: string; policy_check?: { approved?: boolean }; execution_result?: { status?: string; detail?: string; executed_at?: string }; }
interface Plan { id: number; case_id: number; status: string; autonomy_level: string; actions: Action[]; }
function cell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  let start = 0;
  while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/u.test(raw[start]))) start++;
  const safe = '=+@-'.includes(raw[start] ?? '\uffff') ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function responseActionCsv(plan: Plan): string {
  const rows: unknown[][] = [['plan_id', 'case_id', 'plan_status', 'autonomy_level', 'action_position', 'recorded_priority', 'action_type', 'target', 'reason', 'recorded_policy_approval', 'recorded_execution_status', 'recorded_execution_detail', 'recorded_execution_time', 'evidence_scope']];
  plan.actions.forEach((action, index) => rows.push([plan.id, plan.case_id, plan.status, plan.autonomy_level, index + 1, action.priority, action.action_type, action.target, action.reason, action.policy_check?.approved === undefined ? 'unknown' : String(action.policy_check.approved), action.execution_result?.status || 'not recorded', action.execution_result?.detail, action.execution_result?.executed_at, 'loaded saved action evidence; missing results do not establish execution']));
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
