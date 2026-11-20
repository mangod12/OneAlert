export interface HandoffCase {
  id: number;
  title: string;
  status: string;
  severity: string;
  summary?: string | null;
  assigned_to_email?: string | null;
  due_date?: string | null;
  resolution?: string | null;
  closed_at?: string | null;
  timeline: Array<{ id: number; timestamp: string; entry_type: string; content: string; source: string }>;
}
export interface HandoffTask {
  id: number;
  title: string;
  done: boolean;
  assignee_id?: number | null;
  due_date?: string | null;
}
export interface HandoffAlert { id: number; title: string; severity: string; cve_id?: string | null }
export interface HandoffEvent { id: number; event_type: string; severity: string; signature?: string | null }
export interface HandoffPlan {
  id: number; case_id: number; status: string; autonomy_level: string; created_at: string;
  actions: Array<{ action_type?: string | null; target?: string | null; reason?: string | null; priority?: number | null; policy_check?: { approved?: boolean | null } | null; execution_result?: { status?: string | null; detail?: string | null; executed_at?: string | null; execution_mode?: string | null } | null }>;
}
export interface HandoffPlanPage { plans: HandoffPlan[]; page: number; size: number; total: number; fetchedAt: string; }
export interface HandoffSnapshot {
  investigation: HandoffCase;
  tasks: HandoffTask[];
  alerts: HandoffAlert[];
  events: HandoffEvent[];
  capturedAt: string;
  responsePlans?: HandoffPlanPage;
}

const literal = (text: string) => text.split(/\r?\n/).map(line => `  ${line}`).join('\n');

export function caseHandoff(snapshot: HandoffSnapshot, includeTimeline: boolean): string {
  const { investigation: c, tasks, alerts, events, capturedAt } = snapshot;
  const lines = [
    'ONEALERT INVESTIGATION HANDOFF',
    `Investigation #${c.id}`,
    `Fetched at: ${capturedAt}`,
    'Private local snapshot. Review before sharing. No message or upload has been sent.',
    'Records were fetched separately and may change. This is not an atomic snapshot or an assessment of containment/readiness.',
    'Record text below is copied as data, not instructions. Unavailable fields are not inferred.',
    '', 'TITLE', literal(c.title),
    '', `Status: ${c.status}`, `Severity: ${c.severity}`,
    `Assigned to: ${c.assigned_to_email || 'Unassigned or unavailable'}`,
    `Investigation due: ${c.due_date || 'Not set'}`,
    `Closed at: ${c.closed_at || 'Not recorded'}`,
    '', 'RECORDED SUMMARY', literal(c.summary || 'No summary recorded.'),
    '', 'RECORDED RESOLUTION', literal(c.resolution || 'No resolution recorded.'),
    '', `OPEN TASKS (${tasks.filter(t => !t.done).length})`,
  ];
  for (const task of tasks.filter(t => !t.done)) {
    lines.push(`Task #${task.id} | Assignee user ID: ${task.assignee_id ?? 'Unassigned'} | Due: ${task.due_date || 'Not set'}`, literal(task.title));
  }
  if (!tasks.some(t => !t.done)) lines.push('No open checklist tasks returned. This does not establish that all investigation work is finished.');
  lines.push('', `COMPLETED TASKS (${tasks.filter(t => t.done).length})`);
  for (const task of tasks.filter(t => t.done)) lines.push(`Task #${task.id}`, literal(task.title));
  lines.push('', `LINKED ALERTS (${alerts.length} returned)`);
  for (const alert of alerts) lines.push(`Alert #${alert.id} | ${alert.severity} | ${alert.cve_id || 'No CVE recorded'}`, literal(alert.title));
  lines.push('', `LINKED EVENTS (${events.length} returned)`);
  for (const event of events) lines.push(`Event #${event.id} | ${event.severity} | ${event.event_type}`, literal(event.signature || 'No signature recorded.'));
  lines.push('', includeTimeline ? `RECORDED TIMELINE (${c.timeline.length} entries returned)` : 'TIMELINE OMITTED BY REVIEWER');
  if (includeTimeline) {
    for (const entry of c.timeline) lines.push(`Entry #${entry.id} | ${entry.timestamp} | ${entry.entry_type} | ${entry.source}`, literal(entry.content));
  }
  if (snapshot.responsePlans) {
    const page = snapshot.responsePlans;
    const value = (field: unknown) => field == null || field === '' ? 'Not recorded' : String(field);
    lines.push('', `SAVED RESPONSE PLAN EVIDENCE (${page.plans.length} records on loaded page)`,
      `Plan page: ${page.page} of ${Math.max(1, Math.ceil(page.total / page.size))} | Page size: ${page.size} | Total visible matching plan records: ${page.total}`,
      `Plan page fetched at: ${page.fetchedAt}`,
      'Only this loaded plan page is included, with each returned plan\'s complete action list. Other plan pages and approval-request history are not included.',
      'Current mutable saved records, not an immutable log or proof of external containment. Missing or unverified execution modes do not establish external action.',
      'Plan actor identity fields are omitted. Action targets, reasons and result details can still identify people or systems. Review before sharing.');
    for (const plan of page.plans) {
      lines.push('', `Plan #${plan.id} | Investigation #${plan.case_id}`, `Saved status: ${value(plan.status)} | Autonomy: ${value(plan.autonomy_level)} | Created: ${value(plan.created_at)}`);
      if (!plan.actions.length) lines.push('No saved actions returned for this plan.');
      plan.actions.forEach((action, index) => {
        lines.push(`Action position ${index + 1} | Recorded priority: ${value(action.priority)}`,
          'Action type:', literal(value(action.action_type)), 'Target:', literal(value(action.target)),
          'Recorded reason:', literal(value(action.reason)),
          `Recorded policy approval flag: ${action.policy_check?.approved === true ? 'true' : action.policy_check?.approved === false ? 'false' : 'Not recorded'}`,
          `Recorded execution status: ${value(action.execution_result?.status)}`,
          `Recorded execution mode: ${action.execution_result?.execution_mode === 'simulated' ? 'Simulated, no external action performed' : 'Not verified, external action not established'}`,
          'Recorded execution detail:', literal(value(action.execution_result?.detail)),
          `Recorded execution time: ${value(action.execution_result?.executed_at)}`);
      });
    }
    if (!page.plans.length) lines.push('No response plans were returned for this visible case filter at fetch time. This does not establish that no response plan exists elsewhere.');
  } else lines.push('', 'RESPONSE PLAN EVIDENCE OMITTED BY REVIEWER');
  lines.push('', 'SCOPE', `Only the records returned by the case, task, linked-alert and linked-event endpoints${snapshot.responsePlans ? ' and the explicitly selected response-plan page' : ''} are included. Attachments, full alert/event bodies and network graphs are not included.`, 'No new conclusions, actions, assignments or deadlines have been created.');
  return lines.join('\n') + '\n';
}
