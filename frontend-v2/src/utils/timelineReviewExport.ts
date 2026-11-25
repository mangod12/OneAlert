import type { TimelineRecord } from '../components/TimelineExplorer';
export interface TimelineExportSnapshot {
  caseId: number; title: string; capturedAt: string; loadedCount: number; excludedPinnedCount: number;
  filters: { searchField?: 'all' | 'content' | 'author' | 'id'; query: string; kind: string; source: string; order: string; author: string; from: string; through: string };
  rows: TimelineRecord[];
}
export function timelineExportEvidenceValid(caseId: number, title: string, rows: TimelineRecord[], loadedCount: number, excludedPinnedCount = 0): boolean {
  return Number.isSafeInteger(caseId) && caseId > 0 && typeof title === 'string'
    && Number.isSafeInteger(loadedCount) && loadedCount >= rows.length
    && Number.isSafeInteger(excludedPinnedCount) && excludedPinnedCount >= 0 && excludedPinnedCount <= loadedCount - rows.length
    && new Set(rows.map(row => row?.id)).size === rows.length
    && rows.every(row => row != null && Number.isSafeInteger(row.id) && row.id > 0
      && typeof row.timestamp === 'string' && typeof row.entry_type === 'string' && typeof row.source === 'string'
      && typeof row.content === 'string' && (row.author_email === null || typeof row.author_email === 'string'));
}
function requireTimelineExportEvidence(snapshot: TimelineExportSnapshot): void {
  if (!timelineExportEvidenceValid(snapshot.caseId, snapshot.title, snapshot.rows, snapshot.loadedCount, snapshot.excludedPinnedCount)) throw Error('Invalid timeline export evidence');
}
export function timelineReviewCsv(snapshot: TimelineExportSnapshot): string {
  requireTimelineExportEvidence(snapshot);
  const cell = (value: unknown) => {
    const text = String(value ?? ''); let start = 0; while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++; const trimmed = text.slice(start);
    return '"' + (['=', '+', '-', '@'].includes(trimmed[0]) ? "'" + text : text).replaceAll('"', '""') + '"';
  };
  const f = snapshot.filters;
  const rows: unknown[][] = [['scope', 'case_id', 'case_title', 'captured_at', 'loaded_count', 'matching_count', 'outside_filter_pinned_excluded', 'text_query', 'type_filter', 'source_filter', 'author_filter', 'from_utc_date', 'through_utc_date', 'order', 'entry_id', 'recorded_timestamp', 'entry_type', 'source', 'recorded_author', 'content', 'search_field']];
  for (const row of snapshot.rows) rows.push(['Only this captured loaded matching timeline review, not the full timeline, edit history or audit evidence. No unsaved edits included. No upload or message sent.', snapshot.caseId, snapshot.title, snapshot.capturedAt, snapshot.loadedCount, snapshot.rows.length, snapshot.excludedPinnedCount, f.query, f.kind, f.source, f.author, f.from, f.through, f.order, row.id, row.timestamp, row.entry_type, row.source, row.author_email, row.content, f.searchField || 'all']);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function timelineReviewJson(snapshot: TimelineExportSnapshot): string {
  requireTimelineExportEvidence(snapshot);
  const f = snapshot.filters;
  return JSON.stringify({
    format: 'onealert.loaded-matching-timeline-review', version: 1,
    scope: 'Only frozen matching entries from this loaded timeline review across local pages, not the full timeline, edit history, source truth or audit evidence. Outside-filter pinned entries and unsaved edits excluded. No upload, message or access grant sent.',
    investigation_id: snapshot.caseId, investigation_title: snapshot.title, captured_at: snapshot.capturedAt,
    loaded_entry_count: snapshot.loadedCount, captured_entry_count: snapshot.rows.length, excluded_outside_filter_pinned_count: snapshot.excludedPinnedCount,
    captured_filters: { search_field: f.searchField ?? 'all', query: f.query, type: f.kind, source: f.source, recorded_author: f.author, from_utc_date: f.from || null, through_utc_date: f.through || null, order: f.order },
    entries: snapshot.rows.map(row => ({ entry_id: row.id, recorded_timestamp: row.timestamp, entry_type: row.entry_type, source: row.source, recorded_author: row.author_email, content: row.content })),
  }, null, 2) + '\n';
}
