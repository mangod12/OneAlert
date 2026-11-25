import { validTaskDate } from './checklistTriage';
export function workloadDueScopeMatches(value: string | null, filters: { due: string; today: string; dueFrom: string; dueThrough: string }): boolean {
  if (filters.due === 'all') return true;
  if (filters.due === 'none') return value === null;
  if (!validTaskDate(value)) return false;
  if (filters.due === 'range') return validTaskDate(filters.dueFrom) && validTaskDate(filters.dueThrough) && filters.dueFrom <= filters.dueThrough && value >= filters.dueFrom && value <= filters.dueThrough;
  if (!validTaskDate(filters.today)) return false;
  return filters.due === 'overdue' ? value < filters.today : filters.due === 'today' ? value === filters.today : filters.due === 'future' ? value > filters.today : false;
}
