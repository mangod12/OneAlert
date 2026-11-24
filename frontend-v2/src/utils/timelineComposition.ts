import { timelineUtcDay } from './timelineReview';
export interface CompositionEntry { entry_type: string; source: string; author_email: string | null }
export function timelineComposition(entries: CompositionEntry[]): { facet: 'kind' | 'source' | 'author'; label: string; rows: { value: string; label: string; count: number }[] }[] {
  if (!entries.length) return [];
  return ([['kind', 'Recorded entry types'], ['source', 'Recorded source categories'], ['author', 'Recorded authors']] as const).map(([facet, label]) => {
    const counts = new Map<string, number>();
    for (const entry of entries) { const value = facet === 'kind' ? entry.entry_type : facet === 'source' ? entry.source : entry.author_email || 'unrecorded'; if (value) counts.set(value, (counts.get(value) || 0) + 1); }
    return { facet, label, rows: [...counts].map(([value, count]) => ({ value, count, label: facet === 'author' && value === 'unrecorded' ? 'Author not recorded' : value })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) };
  });
}

export function timelineDayComposition(entries: { timestamp: string }[]): { days: { day: string; count: number }[]; undated: number } {
  const counts = new Map<string, number>(); let undated = 0;
  for (const entry of entries) { const day = timelineUtcDay(entry.timestamp); if (day) counts.set(day, (counts.get(day) || 0) + 1); else undated++; }
  return { days: [...counts].map(([day, count]) => ({ day, count })).sort((a, b) => b.day.localeCompare(a.day)), undated };
}
