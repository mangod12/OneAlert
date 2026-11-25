import { expect, it } from 'vitest';
import { timelineComparisonJson } from './timelineComparisonExport';
const baseline = { id: 1, timestamp: 'bad raw time', entry_type: 'note', source: '', author_email: null, content: '=SUM(A1)\n<script>literal</script>', private_value: 'never export' };
const comparison = { ...baseline, id: 2, author_email: '' };
it('allowlists raw saved fields, preserves null and empty and never mutates source records', () => {
 const before = JSON.stringify([baseline, comparison]); const value = JSON.parse(timelineComparisonJson(baseline, comparison)); expect(Object.keys(value)).toEqual(['format', 'version', 'scope', 'baseline', 'comparison', 'different_fields']); expect(Object.keys(value.baseline)).toEqual(['entry_id', 'recorded_timestamp', 'entry_type', 'source', 'recorded_author', 'content']); expect(value.baseline.content).toBe(baseline.content); expect(value.baseline.recorded_timestamp).toBe('bad raw time'); expect(value.baseline.recorded_author).toBeNull(); expect(value.comparison.recorded_author).toBe(''); expect(value.different_fields).toEqual(['author_email']); expect(JSON.stringify(value)).not.toContain('never export'); expect(JSON.stringify([baseline, comparison])).toBe(before);
});
it('compares exact raw strings rather than normalized dates and labels no chronology', () => {
 const value = JSON.parse(timelineComparisonJson({ ...baseline, timestamp: '2026-11-25T00:00:00Z' }, { ...baseline, id: 2, timestamp: '2026-11-25T00:00:00+00:00' })); expect(value.different_fields).toEqual(['timestamp']); expect(value.scope).toContain('not chronology');
});
it('exports same-valued different entries with no invented differences', () => { expect(JSON.parse(timelineComparisonJson(baseline, { ...baseline, id: 2 })).different_fields).toEqual([]); });
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid identities %s', id => { expect(() => timelineComparisonJson({ ...baseline, id }, comparison)).toThrow(); });
it('rejects same identity and incorrect raw types without coercion', () => { expect(() => timelineComparisonJson(baseline, baseline)).toThrow(); expect(() => timelineComparisonJson({ ...baseline, content: 4 } as unknown as typeof baseline, comparison)).toThrow(); expect(() => timelineComparisonJson({ ...baseline, author_email: undefined } as unknown as typeof baseline, comparison)).toThrow(); });
