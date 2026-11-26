// Compare full retained row values, not event identities or live data.
export function retainedHuntDuplicateGroups(rows: Record<string, unknown>[]): number[][] {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = JSON.stringify(canonical(row));
    const positions = groups.get(key);
    if (positions) positions.push(index + 1);
    else groups.set(key, [index + 1]);
  });
  return [...groups.values()].filter(positions => positions.length > 1);
}
