export interface ChecklistTask { id: number; title: string; done: boolean; position: number; assignee_id: number | null; due_date: string | null; }
export interface ChecklistFilters { query: string; status: string; assignee: string; due: string; sort: string; }
export const defaultChecklistFilters: ChecklistFilters = { query: '', status: 'all', assignee: 'all', due: 'all', sort: 'position' };
export function validTaskDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function filterChecklist<T extends ChecklistTask>(tasks: T[], filters: ChecklistFilters, today: string, currentUserId: number | null): T[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const todayValid = validTaskDate(today);
  return tasks.filter(task => {
    const dated = validTaskDate(task.due_date);
    return (!query || task.title.toLocaleLowerCase().includes(query)) &&
      (filters.status === 'all' || (filters.status === 'open' ? !task.done : task.done)) &&
      (filters.assignee === 'all' || (filters.assignee === 'unassigned' ? task.assignee_id == null : filters.assignee === 'mine' ? currentUserId !== null && task.assignee_id === currentUserId : task.assignee_id === Number(filters.assignee))) &&
      (filters.due === 'all' || (filters.due === 'undated' ? !dated : todayValid && dated && !task.done && (filters.due === 'overdue' ? task.due_date! < today : filters.due === 'today' ? task.due_date === today : task.due_date! > today)));
  }).sort((a, b) => {
    const fallback = a.position - b.position || a.id - b.id;
    if (filters.sort === 'title') return a.title.localeCompare(b.title) || fallback;
    if (filters.sort === 'due') { const aDate = validTaskDate(a.due_date) ? a.due_date : '9999-99-99', bDate = validTaskDate(b.due_date) ? b.due_date : '9999-99-99'; return aDate.localeCompare(bDate) || fallback; }
    return fallback;
  });
}
