import { validTaskDate, type ChecklistTask } from './checklistTriage';
export interface ChecklistWorkload { assigneeId: number | null; total: number; open: number; completed: number; overdue: number; today: number; later: number; undated: number; }
export function checklistWorkload(tasks: ChecklistTask[], today: string): ChecklistWorkload[] {
  const groups = new Map<number | null, ChecklistWorkload>();
  for (const task of tasks) {
    const id = task.assignee_id ?? null;
    const row = groups.get(id) ?? { assigneeId: id, total: 0, open: 0, completed: 0, overdue: 0, today: 0, later: 0, undated: 0 };
    row.total += 1;
    if (task.done) row.completed += 1;
    else {
      row.open += 1;
      if (!validTaskDate(task.due_date)) row.undated += 1;
      else if (validTaskDate(today)) {
        if (task.due_date < today) row.overdue += 1;
        else if (task.due_date === today) row.today += 1;
        else row.later += 1;
      }
    }
    groups.set(id, row);
  }
  return [...groups.values()].sort((a, b) => b.overdue - a.overdue || b.today - a.today || b.open - a.open || (a.assigneeId ?? -1) - (b.assigneeId ?? -1));
}
