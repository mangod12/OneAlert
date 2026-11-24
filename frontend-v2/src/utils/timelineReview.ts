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

export function timelineRecordedTime(timestamp: string): number | null {
  const fields = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))?$/.exec(timestamp);
  if (!fields || !validTaskDate(fields[1]) || Number(fields[2]) > 23 || Number(fields[3]) > 59 || Number(fields[4]) > 59 || (fields[5] && (Number(fields[6]) > 23 || Number(fields[7]) > 59))) return null;
  const time = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? timestamp : timestamp + 'Z');
  return Number.isFinite(time) ? time : null;
}
export function timelineUtcDay(timestamp: string): string | null {
  const time = timelineRecordedTime(timestamp);
  return time === null ? null : new Date(time).toISOString().slice(0, 10);
}
