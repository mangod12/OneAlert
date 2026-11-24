import { validTaskDate } from './checklistTriage';
export interface TimelineReviewFilters { author: string; from: string; through: string }
export function timelineWindowValid(filters: TimelineReviewFilters): boolean {
  return (!filters.from || validTaskDate(filters.from)) && (!filters.through || validTaskDate(filters.through)) && (!filters.from || !filters.through || filters.from <= filters.through);
}
export function timelineReviewMatch(entry: { author_email: string | null; timestamp: string }, filters: TimelineReviewFilters): boolean {
  if (!timelineWindowValid(filters)) return false;
  if (filters.author && (filters.author === 'unrecorded' ? !!entry.author_email : entry.author_email !== filters.author)) return false;
  if (!filters.from && !filters.through) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(entry.timestamp) || !validTaskDate(entry.timestamp.slice(0, 10))) return false;
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/.test(entry.timestamp) ? entry.timestamp : entry.timestamp + 'Z';
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return false;
  const utc = new Date(time).toISOString().slice(0, 10);
  return (!filters.from || utc >= filters.from) && (!filters.through || utc <= filters.through);
}
