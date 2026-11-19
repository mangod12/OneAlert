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
export interface HandoffSnapshot {
  investigation: HandoffCase;
  tasks: HandoffTask[];
  alerts: HandoffAlert[];
  events: HandoffEvent[];
  capturedAt: string;
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
  lines.push('', 'SCOPE', 'Only the records returned by the case, task, linked-alert and linked-event endpoints are included. Response plans, attachments, full alert/event bodies and network graphs are not included.', 'No new conclusions, actions, assignments or deadlines have been created.');
  return lines.join('\n') + '\n';
}
