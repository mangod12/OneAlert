export interface WindowScope { started_at: string; ended_before: string }
export interface Bucket extends WindowScope { count: number }
export interface Timeline extends WindowScope { source_id: number; bucket_hours: number; total: number; buckets: Bucket[]; retrieved_at: string; scope: string }
export interface WindowRecord { id: number; timestamp: string; event_type: string; severity: string | null; signature: string | null; source_ip: string | null; dest_ip: string | null; hostname: string | null; source_type: string | null; processed: string | null }
export interface WindowPage extends WindowScope { source_id: number; total: number; page: number; size: number; records: WindowRecord[]; retrieved_at: string; scope: string }
export const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const same = (a: unknown, b: unknown) => time(a) && time(b) && Date.parse(a) === Date.parse(b);
export function validWindow(scope: WindowScope, hours = 1) {
  const start = Date.parse(scope.started_at), end = Date.parse(scope.ended_before), step = hours * 3600000;
  return [1, 6, 24].includes(hours) && time(scope.started_at) && time(scope.ended_before) && start >= 0 && end < Date.parse('2101-01-01T00:00:00Z') && end > start && end - start <= 31 * 86400000 && start % step === 0 && end % step === 0;
}
export function validTimeline(value: Timeline, sourceId: number, scope: WindowScope, hours: number) {
  if (!value || !validWindow(scope, hours) || value.source_id !== sourceId || value.bucket_hours !== hours || !same(value.started_at, scope.started_at) || !same(value.ended_before, scope.ended_before) || !count(value.total) || !time(value.retrieved_at) || typeof value.scope !== 'string' || !Array.isArray(value.buckets) || value.buckets.length !== (Date.parse(scope.ended_before) - Date.parse(scope.started_at)) / (hours * 3600000)) return false;
  return value.buckets.every((row, index) => row && count(row.count) && same(row.started_at, new Date(Date.parse(scope.started_at) + index * hours * 3600000).toISOString()) && same(row.ended_before, new Date(Date.parse(scope.started_at) + (index + 1) * hours * 3600000).toISOString())) && value.buckets.reduce((sum, row) => sum + row.count, 0) === value.total;
}
export function validWindowPage(value: WindowPage, sourceId: number, scope: WindowScope, page: number) {
  return value && validWindow(scope) && value.source_id === sourceId && same(value.started_at, scope.started_at) && same(value.ended_before, scope.ended_before) && value.page === page && value.size === 10 && count(value.total) && time(value.retrieved_at) && typeof value.scope === 'string' && Array.isArray(value.records) && value.records.length <= 10 && new Set(value.records.map(row => row?.id)).size === value.records.length && value.records.every(row => row && count(row.id) && row.id > 0 && time(row.timestamp) && Date.parse(row.timestamp) >= Date.parse(scope.started_at) && Date.parse(row.timestamp) < Date.parse(scope.ended_before) && typeof row.event_type === 'string' && (['severity', 'signature', 'source_ip', 'dest_ip', 'hostname', 'source_type', 'processed'] as const).every(key => row[key] === null || typeof row[key] === 'string'));
}
