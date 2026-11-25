import type { TimelineRecord } from '../components/TimelineExplorer';
const fields = ['timestamp', 'entry_type', 'source', 'author_email', 'content'] as const;
export function timelineComparisonJson(baseline: TimelineRecord, comparison: TimelineRecord): string {
  const valid = (row: TimelineRecord) => Number.isSafeInteger(row.id) && row.id > 0 && fields.every(key => key === 'author_email' ? row[key] === null || typeof row[key] === 'string' : typeof row[key] === 'string');
  if (!valid(baseline) || !valid(comparison) || baseline.id === comparison.id) throw Error('Invalid captured comparison');
  const entry = (row: TimelineRecord) => ({ entry_id: row.id, recorded_timestamp: row.timestamp, entry_type: row.entry_type, source: row.source, recorded_author: row.author_email, content: row.content });
  return JSON.stringify({ format: 'onealert.captured-timeline-entry-comparison', version: 1, scope: 'Only two entries from a frozen loaded timeline review. Baseline is a viewing choice, not chronology, edit history, source truth or audit evidence. No investigation context or full capture is included. All saved fields are included regardless of difference focus. No upload, message or access grant sent.', baseline: entry(baseline), comparison: entry(comparison), different_fields: fields.filter(key => baseline[key] !== comparison[key]) }, null, 2) + '\n';
}
