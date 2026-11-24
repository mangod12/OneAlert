import { defaultChecklistFilters, type ChecklistFilters } from './checklistTriage';
const names = ['checklist', 'checklist_query', 'checklist_status', 'checklist_assignee', 'checklist_due', 'checklist_sort'];
export function readChecklistFilterLink(search: string): { filters: ChecklistFilters; invalid: boolean } {
  const params = new URLSearchParams(search), filters = { ...defaultChecklistFilters };
  if (!names.some(key => params.has(key))) return { filters, invalid: false };
  if (names.some(key => params.getAll(key).length > 1) || params.get('checklist') !== '1' || params.has('task')) return { filters, invalid: true };
  filters.query = params.get('checklist_query') ?? '';
  filters.status = params.get('checklist_status') ?? 'all';
  filters.assignee = params.get('checklist_assignee') ?? 'all';
  filters.due = params.get('checklist_due') ?? 'all';
  filters.sort = params.get('checklist_sort') ?? 'position';
  const validAssignee = ['all', 'unassigned'].includes(filters.assignee) || (/^[1-9][0-9]*$/.test(filters.assignee) && Number.isSafeInteger(Number(filters.assignee)));
  return { filters, invalid: filters.query.length > 200 || !['all', 'open', 'done'].includes(filters.status) || !validAssignee || !['all', 'overdue', 'today', 'upcoming', 'undated'].includes(filters.due) || !['position', 'due', 'title'].includes(filters.sort) };
}
export function checklistFilterLink(origin: string, caseId: number, filters: ChecklistFilters, currentUserId: number | null): string {
  if (!Number.isSafeInteger(caseId) || caseId < 1) throw Error('Invalid investigation');
  const resolved = { ...filters, assignee: filters.assignee === 'mine' ? String(currentUserId) : filters.assignee };
  const url = new URL(`/app/cases/${caseId}`, origin);
  for (const [key, value] of Object.entries({ checklist: '1', checklist_query: resolved.query, checklist_status: resolved.status, checklist_assignee: resolved.assignee, checklist_due: resolved.due, checklist_sort: resolved.sort })) url.searchParams.set(key, value);
  if (readChecklistFilterLink(url.search).invalid) throw Error('Invalid checklist filter scope');
  return url.toString();
}
