import { describe, expect, it } from 'vitest';
import { huntEvidenceJson, compareRetainedHuntRows, huntQueryCsv, huntQueryJson, huntRowJson, huntRowComparisonJson, huntRowComparisonCsv } from './huntEvidence';

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

it('exports one query with raw typed retained evidence and exact context without extra query fields', () => {
 const input = { outcome: 'completed' as const, query: { sql: 'SELECT id', params: { flag: false } }, time_window: { since: 'raw offset' }, row_count: 500, rows: [{ id: 0, empty: '', absent: null, nested: { false: false }, text: '=SUM(A1) <script>literal</script>' }], private_extra: 'omit' }; const before = JSON.stringify(input); const value = JSON.parse(huntQueryJson(input, 1, 'saved time')); expect(value.query_position).toBe(2); expect(value.result.reported_row_count).toBe(500); expect(value.result.rows).toEqual(input.rows); expect(value.result.query).toEqual(input.query); expect(value.result.time_window).toEqual(input.time_window); expect(value.result.private_extra).toBeUndefined(); expect(value.scope).toContain('No queries were rerun'); expect(JSON.stringify(input)).toBe(before);
});
it('preserves missing evidence versus known empty retained rows and failure outcome', () => {
 expect(JSON.parse(huntQueryJson({}, 0, 'time')).result).toEqual({}); expect(JSON.parse(huntQueryJson({ outcome: 'failed', error: 'Recorded failure', rows: [] }, 0, 'time')).result).toEqual({ outcome: 'failed', error: 'Recorded failure', rows: [] }); expect(() => huntQueryJson({}, -1, 'time')).toThrow();
});
it('exports all retained pages rather than reported unretained rows', () => { const value = JSON.parse(huntQueryJson({ rows: Array.from({ length: 45 }, (_, id) => ({ id })), row_count: 100 }, 0, 'time')); expect(value.result.rows).toHaveLength(45); expect(value.result.rows[44].id).toBe(44); });

it('exports matching retained rows with search scope while leaving original query count and context intact', () => {
 const value = JSON.parse(huntQueryJson({ query: { sql: 'SELECT id, metadata' }, row_count: 120, rows: [{ id: 23, metadata: { raw: false }, zero: 0 }] }, 0, 'time', { text: 'FALSE', field: 'metadata', retained_total: 45 })); expect(value.retained_search).toEqual({ text: 'FALSE', field: 'metadata', retained_total: 45 }); expect(value.result.rows).toEqual([{ id: 23, metadata: { raw: false }, zero: 0 }]); expect(value.result.reported_row_count).toBe(120); expect(value.scope).toContain('not all retained or reported rows'); expect(value.result.query.sql).toBe('SELECT id, metadata'); expect(JSON.parse(huntQueryJson({}, 0, 'time')).retained_search).toBeUndefined();
});


it('exports only one original retained row with typed hidden fields and unchanged query context and counts', () => {
 const input = { outcome: 'completed' as const, query: { sql: 'SELECT id, detail', params: { flag: false } }, time_window: { since: 'recorded-bound' }, row_count: 120, rows: [{ id: 8 }, { id: 3, detail: { raw: false }, zero: 0, missing: null, text: '=SUM(A1) <script>literal</script>' }] }, before=JSON.stringify(input); const value=JSON.parse(huntRowJson(input, 1, 2, 'export-time')); expect(value.format).toBe('onealert.retained-hunt-row'); expect(value.version).toBe(1); expect(value.query_position).toBe(2); expect(value.retained_row_position).toBe(2); expect(value.retained_total).toBe(2); expect(value.exported_at).toBe('export-time'); expect(value.result.rows).toEqual([input.rows[1]]); expect(value.result.reported_row_count).toBe(120); expect(value.result.query).toEqual(input.query); expect(value.result.time_window).toEqual(input.time_window); expect(value.scope).toContain('Only one retained row'); expect(value.retained_search).toBeUndefined(); expect(JSON.stringify(input)).toBe(before);
});
it('rejects missing and invalid retained row or query positions without guessing a selection', () => {
 for(const row of [0,-1,1.5,NaN,Infinity,2]) expect(()=>huntRowJson({rows:[{id:1}]},0,row,'time')).toThrow(); expect(()=>huntRowJson({},0,1,'time')).toThrow(); expect(()=>huntRowJson({rows:[]},0,1,'time')).toThrow(); expect(()=>huntRowJson({rows:[{id:1}]},-1,1,'time')).toThrow(); const value=JSON.parse(huntRowJson({rows:[{id:1}]},0,1,'time')); expect(value.result).not.toHaveProperty('reported_row_count'); expect(value.result).not.toHaveProperty('query');
});


it('compares every retained field with typed nested equality and missing distinct from null', () => {
 const left={id:1,nested:{a:0,b:false},array:[1,2],nullOnly:null,text:'1',raw:'<script>literal</script>'},right={id:2,nested:{b:false,a:0},array:[2,1],text:1,added:null,raw:'<script>literal</script>'},before=JSON.stringify([left,right]); const fields=compareRetainedHuntRows(left,right);expect(fields.map(item=>[item.field,item.status])).toEqual([['id','Different recorded value'],['nested','Same recorded value'],['array','Different recorded value'],['nullOnly','Only in baseline row'],['text','Different recorded value'],['raw','Same recorded value'],['added','Only in inspected row']]);expect(fields.find(item=>item.field==='nullOnly')).toMatchObject({baselinePresent:true,inspectedPresent:false,baseline:null});expect(fields.find(item=>item.field==='added')).toMatchObject({baselinePresent:false,inspectedPresent:true,inspected:null});expect(JSON.stringify([left,right])).toBe(before);
});
it('compares empty and falsy values without collapsing types or nested missing keys',()=>{
 const fields=compareRetainedHuntRows({a:false,b:0,c:'',d:{a:null},e:[{a:1,b:2}]},{a:0,b:'0',c:null,d:{},e:[{b:2,a:1}]});expect(fields.map(item=>item.status)).toEqual(['Different recorded value','Different recorded value','Different recorded value','Different recorded value','Same recorded value']);expect(compareRetainedHuntRows({},{})).toEqual([]);
});


it('exports both retained positions all typed fields and original query context in a comparison artifact',()=>{
 const input={query:{sql:'SELECT id, detail',params:{limit:100}},time_window:{since:'saved-bound'},row_count:120,rows:[{id:3,old:null,detail:{a:false},raw:'=1 <script>literal</script>'},{id:1,new:0,detail:{a:false}}]},before=JSON.stringify(input);const value=JSON.parse(huntRowComparisonJson(input,1,1,2,'time'));expect(value.format).toBe('onealert.retained-hunt-row-comparison');expect(value.query_position).toBe(2);expect(value.retained_total).toBe(2);expect(value.baseline).toEqual({retained_row_position:1,row:input.rows[0]});expect(value.inspected).toEqual({retained_row_position:2,row:input.rows[1]});expect(value.query_context).toEqual({query:input.query,time_window:input.time_window,reported_row_count:120});expect(value.fields).toHaveLength(5);expect(value.fields.find((field:{field:string})=>field.field==='old')).toMatchObject({baselinePresent:true,inspectedPresent:false,baseline:null});expect(value.fields.find((field:{field:string})=>field.field==='detail').status).toBe('Same recorded value');expect(JSON.stringify(input)).toBe(before);
});
it('rejects equal invalid or missing comparison positions and preserves absent query metadata',()=>{
 const input={rows:[{id:1},{id:2}]};for(const pair of [[1,1],[0,2],[1,3],[NaN,2],[1,1.5]])expect(()=>huntRowComparisonJson(input,0,pair[0],pair[1],'time')).toThrow();expect(()=>huntRowComparisonJson({},0,1,2,'time')).toThrow();expect(JSON.parse(huntRowComparisonJson(input,0,1,2,'time')).query_context).toEqual({});
});


it('exports all comparison fields as formula-safe CSV with typed JSON presence positions and original counts',()=>{
 const input={row_count:120,rows:[{id:7,'=host':'=SUM(A1)',nullOnly:null,detail:{raw:false},zero:0},{id:2,new:false,detail:{raw:false},zero:'0'}]},before=JSON.stringify(input);const csv=huntRowComparisonCsv(input,1,1,2);expect(csv.startsWith('\ufeff"query_position","baseline_retained_position"')).toBe(true);expect(csv).toContain('"2","1","2","2","120"');expect(csv).toContain('"\'=host"');expect(csv).toContain('"true","null","false",""');expect(csv).toContain('"false","","true","false"');expect(csv).toContain('"true","0","true","""0"""');expect(csv).toContain('"true","{""raw"":false}"');expect(csv).toContain('not versions of one event');expect(csv).toContain('regardless of local comparison focus');expect(csv.split('\r\n')).toHaveLength(8);expect(JSON.stringify(input)).toBe(before);
});

it('validates CSV comparison positions and leaves absent counts empty without inventing evidence',()=>{
 const input={rows:[{},{}]};expect(huntRowComparisonCsv(input,0,1,2).split('\r\n')).toHaveLength(2);for(const pair of [[1,1],[0,2],[1,3],[NaN,2],[1,1.5]])expect(()=>huntRowComparisonCsv(input,0,pair[0],pair[1])).toThrow();expect(()=>huntRowComparisonCsv({},0,1,2)).toThrow();const csv=huntRowComparisonCsv({rows:[{id:1},{id:2}]},0,1,2);expect(csv).toContain('"1","1","2","2","",');
});
