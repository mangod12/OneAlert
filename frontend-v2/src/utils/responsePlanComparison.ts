export function stableEvidence(value: unknown): string {
  if (value === undefined) return 'Not recorded';
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : item !== null && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(ordered(value), null, 2) ?? 'Not recorded';
}
export function compareActionPositions(before: unknown[], after: unknown[]) {
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({
    position: index + 1, before: index < before.length ? stableEvidence(before[index]) : null,
    after: index < after.length ? stableEvidence(after[index]) : null,
    change: index >= before.length ? 'added' : index >= after.length ? 'removed' : stableEvidence(before[index]) === stableEvidence(after[index]) ? 'unchanged' : 'changed',
  }));
}
