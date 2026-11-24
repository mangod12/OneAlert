import type { TimelineRecord } from '../components/TimelineExplorer';
export interface TimelineExportSnapshot {
  caseId: number; title: string; capturedAt: string; loadedCount: number; excludedPinnedCount: number;
  filters: { query: string; kind: string; source: string; order: string; author: string; from: string; through: string };
  rows: TimelineRecord[];
}
export function timelineReviewCsv(snapshot: TimelineExportSnapshot): string {
  const cell = (value: unknown) => {
    const text = String(value ?? ''); let start = 0; while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++; const trimmed = text.slice(start);
    return '"' + (['=', '+', '-', '@'].includes(trimmed[0]) ? "'" + text : text).replaceAll('"', '""') + '"';
  };
  const f = snapshot.filters;
  const rows: unknown[][] = [['scope', 'case_id', 'case_title', 'captured_at', 'loaded_count', 'matching_count', 'outside_filter_pinned_excluded', 'text_query', 'type_filter', 'source_filter', 'author_filter', 'from_utc_date', 'through_utc_date', 'order', 'entry_id', 'recorded_timestamp', 'entry_type', 'source', 'recorded_author', 'content']];
  for (const row of snapshot.rows) rows.push(['Only this captured loaded matching timeline review, not the full timeline, edit history or audit evidence. No unsaved edits included. No upload or message sent.', snapshot.caseId, snapshot.title, snapshot.capturedAt, snapshot.loadedCount, snapshot.rows.length, snapshot.excludedPinnedCount, f.query, f.kind, f.source, f.author, f.from, f.through, f.order, row.id, row.timestamp, row.entry_type, row.source, row.author_email, row.content]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
