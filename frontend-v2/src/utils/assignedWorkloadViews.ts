import { validTaskDate } from './checklistTriage';
export interface WorkloadFilters { query: string; severity: string; due: string; today: string; completion: string; investigations: string; dueFrom: string; dueThrough: string; investigationId: number | null; }
export function savedWorkloadFilters(filters: WorkloadFilters) {
  return { query: filters.query, severity: filters.severity, due: filters.due, today: filters.today, completion: filters.completion, investigations: filters.investigations, ...(filters.due === 'range' ? { dueFrom: filters.dueFrom, dueThrough: filters.dueThrough } : {}), ...(filters.investigationId === null ? {} : { investigationId: filters.investigationId }) };
}
export function readWorkloadView(value: unknown): WorkloadFilters | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['query', 'severity', 'due', 'today', 'completion', 'investigations', 'dueFrom', 'dueThrough', 'investigationId'].includes(k))
    || typeof v.query !== 'string' || v.query.length > 200
    || typeof v.severity !== 'string' || typeof v.due !== 'string' || typeof v.completion !== 'string' || typeof v.investigations !== 'string'
    || !['all', 'critical', 'high', 'medium', 'low', 'info'].includes(String(v.severity))
    || !['all', 'overdue', 'today', 'future', 'none', 'range'].includes(String(v.due))
    || !['open', 'completed', 'all'].includes(String(v.completion)) || !['active', 'inactive', 'all'].includes(String(v.investigations))
    || typeof v.today !== 'string' || !validTaskDate(v.today)
    || (v.investigationId != null && (typeof v.investigationId !== 'number' || !Number.isSafeInteger(v.investigationId) || v.investigationId < 1))) return null;
  if (v.due === 'range' ? typeof v.dueFrom !== 'string' || typeof v.dueThrough !== 'string' || !validTaskDate(v.dueFrom) || !validTaskDate(v.dueThrough) || v.dueFrom > v.dueThrough : v.dueFrom != null || v.dueThrough != null) return null;
  return { query: v.query, severity: String(v.severity), due: String(v.due), today: v.today, completion: String(v.completion), investigations: String(v.investigations), dueFrom: typeof v.dueFrom === 'string' ? v.dueFrom : '', dueThrough: typeof v.dueThrough === 'string' ? v.dueThrough : '', investigationId: typeof v.investigationId === 'number' ? v.investigationId : null };
}
