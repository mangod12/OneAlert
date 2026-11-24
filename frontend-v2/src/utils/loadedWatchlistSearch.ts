/** Translate loaded-review semantics without silently widening investigation-only overdue. */
export function loadedWatchlistSearch(filters: { query: string; kind: string; severity: string; scope: string; order: string }): string | null {
  if (filters.query.trim().length > 200 || !['all', 'alert', 'case'].includes(filters.kind) || !['all', 'critical', 'high', 'medium', 'low', 'info'].includes(filters.severity) || !['all', 'open', 'done', 'overdue'].includes(filters.scope) || !['severity', 'newest', 'oldest', 'name'].includes(filters.order) || (filters.scope === 'overdue' && filters.kind === 'alert')) return null;
  const params = new URLSearchParams({ explore: '1' });
  const values = { query: filters.query.trim(), kind: filters.scope === 'overdue' ? 'case' : filters.kind, severity: filters.severity, scope: filters.scope === 'open' ? 'active' : filters.scope, sort: filters.order };
  const defaults = { query: '', kind: 'all', severity: 'all', scope: 'all', sort: 'severity' };
  for (const [key, value] of Object.entries(values)) if (value !== defaults[key as keyof typeof defaults]) params.set(key, value);
  return params.toString();
}
