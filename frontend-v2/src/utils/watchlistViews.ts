export interface WatchlistViewFilters { query: string; kind: string; severity: string; scope: string; sort: string; }
export function checkedWatchlistView(value: unknown): WatchlistViewFilters | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !['query', 'kind', 'severity', 'scope', 'sort'].includes(key)) || typeof v.query !== 'string' || v.query.length > 200
    || typeof v.kind !== 'string' || !['all', 'alert', 'case'].includes(v.kind)
    || typeof v.severity !== 'string' || !['all', 'critical', 'high', 'medium', 'low', 'info'].includes(v.severity)
    || typeof v.scope !== 'string' || !['all', 'active', 'done', 'overdue'].includes(v.scope)
    || typeof v.sort !== 'string' || !['severity', 'newest', 'oldest', 'name', 'due'].includes(v.sort)) return null;
  return { query: v.query.trim(), kind: v.kind, severity: v.severity, scope: v.scope, sort: v.sort };
}
