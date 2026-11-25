import { expect, it } from 'vitest';
import { timelineReviewCsv, timelineReviewJson, timelineExportEvidenceValid, type TimelineExportSnapshot } from './timelineReviewExport';
const snapshot: TimelineExportSnapshot = { caseId: 7, title: 'Case "seven"', capturedAt: '2026-11-24T12:00:00Z', loadedCount: 3, excludedPinnedCount: 1, filters: { query: 'image', kind: 'note', source: 'human', author: 'a@example.test', from: '2026-11-24', through: '2026-11-24', order: 'newest' }, rows: [{ id: 2, timestamp: '2026-11-24T12:00:00', entry_type: 'note', source: 'human', content: 'Image, copied\nnext line', author_email: null }] };
it('records exact loaded scope, criteria, identity and original timestamp and quotes CSV values', () => { const csv = timelineReviewCsv(snapshot); expect(csv.startsWith('\uFEFF')).toBe(true); expect(csv).toContain('not the full timeline'); expect(csv).toContain('"7","Case ""seven"""'); expect(csv).toContain('"3","1","1","image","note","human","a@example.test"'); expect(csv).toContain('"2026-11-24T12:00:00"'); expect(csv).toContain('"Image, copied\nnext line"'); });
it.each(['=SUM(1)', '+cmd', '-1+2', '@SUM(1)', ' \t=cmd', '\u0000+cmd'])('neutralizes formula-like content and metadata: %s', value => { const csv = timelineReviewCsv({ ...snapshot, title: value, filters: { ...snapshot.filters, query: value }, rows: [{ ...snapshot.rows[0], content: value, author_email: value }] }); expect(csv.split('"\'' + value + '"')).toHaveLength(5); });
it('preserves captured row order rather than re-sorting or widening', () => { const csv = timelineReviewCsv({ ...snapshot, rows: [{ ...snapshot.rows[0], id: 9, content: 'first-row' }, { ...snapshot.rows[0], id: 3, content: 'second-row' }] }); expect(csv.indexOf('first-row')).toBeLessThan(csv.indexOf('second-row')); expect(csv).not.toContain('excluded content'); });

it('serializes versioned allowlisted captured rows in exact order with raw text, typed IDs and null authors', () => {
 const value = JSON.parse(timelineReviewJson({ ...snapshot, title: '=case', rows: [{ ...snapshot.rows[0], id: 9, content: '=SUM(A1)', secret: 'excluded' }, { ...snapshot.rows[0], id: 3, author_email: '', timestamp: 'invalid saved date' }] } as TimelineExportSnapshot));
 expect(value.format).toBe('onealert.loaded-matching-timeline-review'); expect(value.version).toBe(1); expect(value.investigation_id).toBe(7); expect(value.investigation_title).toBe('=case'); expect(value.loaded_entry_count).toBe(3); expect(value.captured_entry_count).toBe(2); expect(value.excluded_outside_filter_pinned_count).toBe(1);
 expect(value.entries.map((row: { entry_id: number }) => row.entry_id)).toEqual([9, 3]); expect(value.entries[0].content).toBe('=SUM(A1)'); expect(value.entries[0].recorded_author).toBeNull(); expect(value.entries[1].recorded_author).toBe(''); expect(value.entries[1].recorded_timestamp).toBe('invalid saved date'); expect(value.entries[0]).not.toHaveProperty('secret'); expect(value.captured_filters.search_field).toBe('all');
});
it('preserves exact captured criteria and uses null only for unbounded date filters', () => {
 const value = JSON.parse(timelineReviewJson({ ...snapshot, filters: { ...snapshot.filters, searchField: 'content', query: '=raw', from: '', through: '' } }));
 expect(value.captured_filters).toEqual({ search_field: 'content', query: '=raw', type: 'note', source: 'human', recorded_author: 'a@example.test', from_utc_date: null, through_utc_date: null, order: 'newest' });
 const bounded = JSON.parse(timelineReviewJson(snapshot)); expect(bounded.captured_filters.from_utc_date).toBe('2026-11-24'); expect(bounded.entries[0].recorded_timestamp).toBe('2026-11-24T12:00:00');
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])('rejects unsafe investigation identity %s in both formats', caseId => {
 const bad = { ...snapshot, caseId }; expect(timelineExportEvidenceValid(caseId, bad.title, bad.rows, bad.loadedCount, bad.excludedPinnedCount)).toBe(false); expect(() => timelineReviewCsv(bad)).toThrow(); expect(() => timelineReviewJson(bad)).toThrow();
});
it.each([{ id: 0 }, { id: -2 }, { id: 1.2 }, { id: '2' }, { timestamp: null }, { entry_type: null }, { source: 9 }, { content: undefined }, { author_email: 5 }])('rejects unverified raw fields %o', changes => {
 const bad = { ...snapshot, rows: [{ ...snapshot.rows[0], ...changes }] } as TimelineExportSnapshot; expect(() => timelineReviewCsv(bad)).toThrow(); expect(() => timelineReviewJson(bad)).toThrow();
});
it.each([{ loadedCount: 0 }, { loadedCount: 3.5 }, { excludedPinnedCount: -1 }, { excludedPinnedCount: 3 }, { excludedPinnedCount: 0.5 }, { title: null }, { rows: [snapshot.rows[0], snapshot.rows[0]] }])('rejects ambiguous identities and inconsistent loaded counts %o', changes => {
 const bad = { ...snapshot, ...changes } as TimelineExportSnapshot; expect(() => timelineReviewCsv(bad)).toThrow(); expect(() => timelineReviewJson(bad)).toThrow();
});
it('preserves raw invalid/missing timestamp strings and empty author instead of claiming time validity', () => {
 const raw = { ...snapshot, rows: [{ ...snapshot.rows[0], timestamp: '', author_email: '' }] }; expect(timelineExportEvidenceValid(raw.caseId, raw.title, raw.rows, 3, 1)).toBe(true); expect(JSON.parse(timelineReviewJson(raw)).entries[0].recorded_timestamp).toBe(''); expect(timelineReviewCsv(raw)).toContain('Case');
});
