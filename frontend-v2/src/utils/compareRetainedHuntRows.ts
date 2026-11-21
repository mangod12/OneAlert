import type { HuntQueryResult } from '../components/HuntQueryEvidence';
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export function compareRetainedHuntRows(a: HuntQueryResult, b: HuntQueryResult) {
  if ([a, b].some(q => !Array.isArray(q.rows) || q.rows.length > 1000)) throw Error('Comparison needs recorded row arrays of at most 1,000 rows per query. Missing rows are not inferred as an empty result.');
  const left = a.rows!, right = b.rows!;
  const counts = new Map<string, number>();
  const rightKeys = right.map(canonical);
  for (const key of rightKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const shared: Record<string, unknown>[] = [], onlyA: Record<string, unknown>[] = [];
  for (const row of left) {
    const key = canonical(row), count = counts.get(key) ?? 0;
    if (count) { shared.push(row); counts.set(key, count - 1); } else onlyA.push(row);
  }
  const onlyB = right.filter((_, i) => { const count = counts.get(rightKeys[i]) ?? 0; if (!count) return false; counts.set(rightKeys[i], count - 1); return true; });
  const context = (q: HuntQueryResult) => ({ query: q.query, execution: q.execution, time_window: q.time_window, outcome: q.outcome, error: q.error });
  return { shared, onlyA, onlyB, sameRecordedContext: canonical(context(a)) === canonical(context(b)) };
}
