import type { WatchlistViewFilters } from './watchlistViews';
export type WatchlistMetric = 'alerts' | 'cases' | 'active' | 'done' | 'overdue' | 'active_without_due_date';
/** Preserve the intersection represented by the count, never widen to another due scope. */
export function watchlistDrilldown(filters: WatchlistViewFilters, metric: WatchlistMetric): WatchlistViewFilters | null {
  if (metric === 'alerts' || metric === 'cases') {
    const kind = metric === 'alerts' ? 'alert' : 'case';
    return filters.kind === 'all' || filters.kind === kind ? { ...filters, kind } : null;
  }
  const scope = metric === 'active_without_due_date' ? 'undated' : metric;
  if (metric === 'active') return filters.scope === 'done' ? null : { ...filters, scope: filters.scope === 'all' ? 'active' : filters.scope };
  const allowed = metric === 'done' ? ['all', 'done'] : ['all', 'active', scope];
  return allowed.includes(filters.scope) ? { ...filters, scope } : null;
}
