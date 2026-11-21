import { describe, expect, it } from 'vitest';
import { huntEvidenceJson, huntQueryCsv } from './huntEvidence';

describe('Retained hunt evidence exports', () => {
  it('preserves recorded queries, params, applied metadata, errors and rows without inventing missing values', () => {
    const result = { session_id: 8, hypothesis: 'gateway review', query_results: [
      { query: { sql: 'SELECT id ...', params: { since: '2026-11-20T00:00:00Z' } }, rows: [{ id: 0, nested: { x: false } }] },
      { error: 'Unsupported selection', rows: [] },
    ] };
    const parsed = JSON.parse(huntEvidenceJson(result, '2026-11-20T12:00:00Z'));
    expect(parsed.format).toBe('onealert_hunt_evidence_v1');
    expect(parsed.exported_at).toBe('2026-11-20T12:00:00Z');
    expect(parsed.scope).toContain('No queries were rerun');
    expect(parsed.result).toEqual(result);
    expect(parsed.result.status).toBeUndefined();
    expect(parsed.result.query_results[0].execution).toBeUndefined();
    expect(result.query_results[0].rows).toEqual([{ id: 0, nested: { x: false } }]);
  });

  it('exports every retained row, not only a displayed page, with unioned fields and scoped headers', () => {
    const csv = huntQueryCsv({ outcome: 'completed', row_count: 500, rows: Array.from({ length: 45 }, (_, id) => id === 44 ? { id, extra: 'last' } : { id }) }, 1);
    expect(csv.startsWith('\ufeff"query_index","recorded_outcome","evidence_scope","event.id","event.extra"')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(47);
    expect(csv).toContain('"2","completed"');
    expect(csv).toContain('"44","last"');
    expect(csv).not.toContain('"499"');
  });

  it('escapes CSV text formulas, line breaks and quotes, preserving zero, false and numeric negatives', () => {
    const csv = huntQueryCsv({ rows: [{ a: '=1+1', b: '\t@cmd', c: '  -1+2', d: '+run', e: 'line\n"quote"', zero: 0, no: false, numeric: -2, nested: { a: 0 } }] }, 0);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'\t@cmd"');
    expect(csv).toContain('"\'  -1+2"');
    expect(csv).toContain('"\'+run"');
    expect(csv).toContain('"line\n""quote"""');
    expect(csv).toContain('"0","false","-2","{""a"":0}"');
    expect(csv).toContain('"not recorded"');
  });

  it('has a clear header and no invented data when no evidence rows were retained', () => {
    const csv = huntQueryCsv({ error: 'rejected', rows: [] }, 0);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).not.toContain('completed');
  });
});

it('labels matching retained-row exports with exact local search scope and neutralizes formula-like search text', () => {
  const csv = huntQueryCsv({outcome:'completed',rows:[{host:'match',count:0}]},0,{text:'=search',field:'host',retained_total:45});
  expect(csv).toContain('retained_search_text');expect(csv).toContain('retained_total_before_search');expect(csv).toContain("'=search");expect(csv).toContain('only matching retained rows');expect(csv).toContain('"45"');expect(csv).toContain('"0"');
});
