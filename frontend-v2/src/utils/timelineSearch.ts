export type TimelineSearchField = 'all' | 'content' | 'author' | 'id';
export function timelineSearchValid(query: string, field: TimelineSearchField): boolean {
  return field !== 'id' || !query.trim() || (/^[1-9]\d*$/.test(query.trim()) && Number.isSafeInteger(Number(query.trim())));
}
export function timelineSearchMatch(entry: { id: number; content: string; author_email: string | null; source: string; entry_type: string }, query: string, field: TimelineSearchField): boolean {
  if (!timelineSearchValid(query, field)) return false;
  const needle = query.trim().toLowerCase(); if (!needle) return true;
  if (field === 'id') return entry.id === Number(needle);
  const values = field === 'content' ? [entry.content] : field === 'author' ? [entry.author_email] : [entry.content, entry.author_email, entry.source, entry.entry_type, String(entry.id)];
  return values.some(value => value?.toLowerCase().includes(needle));
}
