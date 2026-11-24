import { validTaskDate } from './checklistTriage';
export interface TimelineReviewFilters { author: string; from: string; through: string }
export function timelineWindowValid(filters: TimelineReviewFilters): boolean {
  return (!filters.from || validTaskDate(filters.from)) && (!filters.through || validTaskDate(filters.through)) && (!filters.from || !filters.through || filters.from <= filters.through);
}
export function timelineReviewMatch(entry: { author_email: string | null; timestamp: string }, filters: TimelineReviewFilters): boolean {
  if (!timelineWindowValid(filters)) return false;
  if (filters.author && (filters.author === 'unrecorded' ? !!entry.author_email : entry.author_email !== filters.author)) return false;
  if (!filters.from && !filters.through) return true;
  const utc = timelineUtcDay(entry.timestamp);
  if (!utc) return false;
  return (!filters.from || utc >= filters.from) && (!filters.through || utc <= filters.through);
}

export function timelineUtcDay(timestamp: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(timestamp) || !validTaskDate(timestamp.slice(0, 10))) return null;
  const time = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? timestamp : timestamp + 'Z');
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
