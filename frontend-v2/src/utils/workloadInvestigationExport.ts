import { checkedWorkloadGroups, type WorkloadGroup } from './assignedWorkloadGroups';
import type { WorkloadExportFilters } from './assignedWorkloadExport';
export interface InvestigationExportSnapshot { groups: WorkloadGroup[]; groupCount: number; total: number; filters: WorkloadExportFilters; loadedAt: string; capturedAt: string; }
export function investigationExportSnapshot(groups: unknown, groupCount: unknown, limit: unknown, total: number, filters: WorkloadExportFilters, loadedAt: string, capturedAt: string): InvestigationExportSnapshot | null {
  if (!Number.isSafeInteger(total) || total < 1) return null;
  const checked = checkedWorkloadGroups(groups, groupCount, limit, total);
  if (!checked?.length) return null;
  return { groups: checked.map(row => ({ ...row })), groupCount: groupCount as number, total, filters: { ...filters }, loadedAt, capturedAt };
}
export function investigationSummaryCsv(snapshot: InvestigationExportSnapshot): string {
  const cell = (value: unknown) => { const text = String(value ?? ''); let start = 0;
    while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++;
    const safe = '=+@-'.includes(text[start] ?? '\uffff') ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"'; };
  const f = snapshot.filters;
  const rows: unknown[][] = [['scope', 'captured_at', 'loaded_at', 'groups_in_export', 'matching_investigations_at_read', 'matching_tasks_at_read', 'group_limit', 'investigation_id', 'matching_tasks', 'open', 'completed', 'without_task_due_date', 'title_query', 'severity_filter', 'due_filter', 'calendar_date', 'completion_filter', 'investigation_scope', 'due_window_from', 'due_window_through', 'exact_investigation_filter', 'task_sort']];
  for (const row of snapshot.groups) rows.push(['Loaded top investigation groups only, not task records, unshown investigations or audit history. Counts span all matching task pages at that read. Group order: matching count descending then investigation ID. Current assignments can change; completion is not remediation proof. No message, upload or grant sent.', snapshot.capturedAt, snapshot.loadedAt, snapshot.groups.length, snapshot.groupCount, snapshot.total, 50, row.case_id, row.total, row.open, row.completed, row.without_due_date, f.query, f.severity, f.due, f.today, f.completion, f.investigations, f.due === 'range' ? f.dueFrom : '', f.due === 'range' ? f.dueThrough : '', f.investigationId ?? '', f.sort ?? 'priority']);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
