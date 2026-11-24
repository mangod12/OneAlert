import { readWorkloadView, savedWorkloadFilters, type WorkloadFilters } from './assignedWorkloadViews';
const fields = ['sort', 'query', 'severity', 'due', 'today', 'completion', 'investigations', 'dueFrom', 'dueThrough', 'investigationId'];
export function parseWorkloadLink(params: URLSearchParams): WorkloadFilters | null | undefined {
  if (!params.has('workload')) return undefined;
  if (params.getAll('workload').length !== 1 || params.get('workload') !== '1' || fields.some(key => params.getAll(key).length > 1)) return null;
  const value: Record<string, unknown> = Object.fromEntries(fields.filter(key => params.has(key)).map(key => [key, params.get(key)!]));
  if (params.has('investigationId')) { const id = params.get('investigationId')!; if (!/^[1-9]\d*$/.test(id)) return null; value.investigationId = Number(id); }
  return readWorkloadView(value);
}
export function workloadSearchLink(origin: string, filters: WorkloadFilters): string {
  const url = new URL('/app/my-tasks', origin); url.searchParams.set('workload', '1');
  for (const [key, value] of Object.entries(savedWorkloadFilters(filters))) url.searchParams.set(key, String(value));
  return url.toString();
}
