import { huntProfileReviewRowsJson, huntProfileReviewCsv, huntProfileReviewJson, huntProfileValueCsv, huntProfileValueJson, huntComparedFieldCsv, huntComparedFieldJson } from './huntEvidence';
import { describe, expect, it } from 'vitest';
import { huntRowFieldsJson, huntRowFieldsCsv, huntEvidenceJson, compareRetainedHuntRows, huntQueryCsv, huntQueryJson, huntRowJson, huntRowComparisonJson, huntRowComparisonCsv, retainedHuntFieldProfile, huntFieldProfileJson, huntFieldProfileCsv, retainedHuntValueRows, retainedHuntMissingRows, huntProfileMatchesJson, huntProfileMatchesCsv, huntFieldCoverageJson, huntFieldCoverageCsv } from './huntEvidence';

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


it('profiles all retained values with typed equality missing distinct from null and stable frequency ordering',()=>{
 const rows=[{x:{a:false,b:0}},{x:{b:0,a:false}},{},{x:null},{x:0},{x:'0'},{x:false},{x:[1,2]},{x:[2,1]},{x:null}],before=JSON.stringify(rows);const profile=retainedHuntFieldProfile(rows,'x');expect(profile).toMatchObject({total:10,present:9,missing:1,nulls:2,distinct:7});expect(profile.values.map(item=>[item.count,item.firstRow])).toEqual([[2,1],[2,4],[1,5],[1,6],[1,7],[1,8],[1,9]]);expect(JSON.stringify(rows)).toBe(before);expect(retainedHuntFieldProfile([],'x')).toEqual({total:0,present:0,missing:0,nulls:0,distinct:0,values:[]});
});
it('profiles unusual field names nested key order and original first positions without prototype inheritance',()=>{
 const row=JSON.parse('{"__proto__":{"x":false}}');expect(retainedHuntFieldProfile([{},row],'__proto__')).toMatchObject({missing:1,present:1,values:[{value:{x:false},count:1,firstRow:2}]});expect(retainedHuntFieldProfile([{x:[{a:1,b:2}]},{x:[{b:2,a:1}]}],'x').distinct).toBe(1);
});


it('exports the full typed retained field profile beyond the presentation limit with exact query context',()=>{
 const input={query:{sql:'SELECT id, x',params:{limit:100}},time_window:{since:'recorded-bound'},row_count:120,rows:[...Array.from({length:12},(_,i)=>({x:i})),{x:null},{},{x:false},{x:'0'}]},before=JSON.stringify(input);const value=JSON.parse(huntFieldProfileJson(input,1,'x','time'));expect(value).toMatchObject({format:'onealert.retained-hunt-field-profile',version:1,exported_at:'time',query_position:2,field:'x',profile:{total:16,present:15,missing:1,nulls:1,distinct:15}});expect(value.profile.values).toHaveLength(15);expect(value.profile.values[14]).toEqual({value:'0',count:1,firstRow:16});expect(value.query_context).toEqual({query:input.query,time_window:input.time_window,reported_row_count:120});expect(value.scope).toContain('displayed profile limit');expect(JSON.stringify(input)).toBe(before);
});
it('validates profile field and query positions and preserves absent context and formula-like text literally',()=>{
 expect(()=>huntFieldProfileJson({},0,'x','time')).toThrow();expect(()=>huntFieldProfileJson({rows:[{}]},0,'x','time')).toThrow();expect(()=>huntFieldProfileJson({rows:[{x:1}]},-1,'x','time')).toThrow();const value=JSON.parse(huntFieldProfileJson({rows:[{'=field':'=1 <script>literal</script>'}]},0,'=field','time'));expect(value.field).toBe('=field');expect(value.profile.values[0].value).toBe('=1 <script>literal</script>');expect(value.query_context).toEqual({});
});


it('finds exact typed profile rows in original positions with nested equality missing-null separation and no mutation',()=>{
 const rows=[{x:0},{x:'0'},{x:null},{},{x:false},{x:{a:1,b:[2,3]}},{x:{b:[2,3],a:1}},{x:{a:1,b:[3,2]}}],before=JSON.stringify(rows);expect(retainedHuntValueRows(rows,'x',1)).toEqual([1]);expect(retainedHuntValueRows(rows,'x',2)).toEqual([2]);expect(retainedHuntValueRows(rows,'x',3)).toEqual([3]);expect(retainedHuntValueRows(rows,'x',6)).toEqual([6,7]);expect(JSON.stringify(rows)).toBe(before);for(const position of [0,-1,1.5,NaN,9,4])expect(retainedHuntValueRows(rows,'x',position)).toEqual([]);
});


it('finds missing fields by own presence without conflating recorded null false zero empty or inherited values',()=>{
 const rows=[{x:null},{},{x:false},{x:0},{x:''},{x:[]},{x:{}},{}],before=JSON.stringify(rows);expect(retainedHuntMissingRows(rows,'x')).toEqual([2,8]);expect(retainedHuntMissingRows([{},JSON.parse('{"__proto__":null}')],'__proto__')).toEqual([1]);expect(retainedHuntMissingRows([],'x')).toEqual([]);expect(JSON.stringify(rows)).toBe(before);
});


it('exports all exact typed matches in original positions with full rows and query context beyond displayed pages',()=>{
 const input={query:{sql:'SELECT id, tag',params:{limit:100}},row_count:120,rows:Array.from({length:45},(_,i)=>({id:i+1,tag:{raw:false},text:'=1 <script>literal</script>'}))},before=JSON.stringify(input);const value=JSON.parse(huntProfileMatchesJson(input,1,'tag',{kind:'value',firstRow:1},'time'));expect(value).toMatchObject({format:'onealert.retained-hunt-profile-matches',query_position:2,field:'tag',retained_total:45,matched_retained_count:45,selection:{kind:'value',first_retained_position:1,value:{raw:false}}});expect(value.rows[44]).toEqual({retained_row_position:45,row:input.rows[44]});expect(value.query_context).toEqual({query:input.query,reported_row_count:120});expect(JSON.stringify(input)).toBe(before);
});
it('exports missing fields separately from null and rejects invalid empty or absent profile selections',()=>{
 const input={rows:[{x:null},{id:2},{x:0},{x:'0'}]};const missing=JSON.parse(huntProfileMatchesJson(input,0,'x',{kind:'missing'},'time'));expect(missing.selection).toEqual({kind:'missing'});expect(missing.rows).toEqual([{retained_row_position:2,row:{id:2}}]);expect(missing.query_context).toEqual({});expect(JSON.parse(huntProfileMatchesJson(input,0,'x',{kind:'value',firstRow:1},'time')).rows).toHaveLength(1);for(const position of [0,2,9,NaN])expect(()=>huntProfileMatchesJson(input,0,'x',{kind:'value',firstRow:position},'time')).toThrow();expect(()=>huntProfileMatchesJson({rows:[{x:0}]},0,'x',{kind:'missing'},'time')).toThrow();expect(()=>huntProfileMatchesJson(input,-1,'x',{kind:'missing'},'time')).toThrow();expect(()=>huntProfileMatchesJson({},0,'x',{kind:'missing'},'time')).toThrow();
});


it('exports every typed field profile value as CSV with full counts first positions and spreadsheet protection',()=>{
 const input={row_count:120,rows:[...Array.from({length:12},(_,i)=>({'=field':i})),{'=field':null},{},{'=field':false},{'=field':'0'},{'=field':{raw:false}},{'=field':0}]},before=JSON.stringify(input);const csv=huntFieldProfileCsv(input,1,'=field');expect(csv.startsWith('\ufeff"query_position","field"')).toBe(true);expect(csv).toContain('"2","\'=field","18","120","17","1","1","16"');expect(csv).toContain('"0","2","1"');expect(csv).toContain('"null","1","13"');expect(csv).toContain('"false","1","15"');expect(csv).toContain('"""0""","1","16"');expect(csv).toContain('"{""raw"":false}","1","17"');expect(csv.split('\r\n')).toHaveLength(18);expect(JSON.stringify(input)).toBe(before);
});
it('validates CSV field and index without inventing reported counts or interpreting raw JSON strings',()=>{
 expect(()=>huntFieldProfileCsv({},0,'x')).toThrow();expect(()=>huntFieldProfileCsv({rows:[{}]},0,'x')).toThrow();expect(()=>huntFieldProfileCsv({rows:[{x:0}]},-1,'x')).toThrow();const csv=huntFieldProfileCsv({rows:[{x:'=SUM(A1)'},{x:'line\n"quote"'}]},0,'x');expect(csv).toContain('"1","x","2","","2","0","0","2"');expect(csv).toContain('"""=SUM(A1)"""');expect(csv).toContain('line\\n');
});


it('exports every matching typed profile row to CSV across pages with original positions and presence columns',()=>{
 const input={row_count:120,rows:Array.from({length:45},(_,i)=>i===44?{id:i+1,tag:false,extra:null}:{id:i+1,tag:false})},before=JSON.stringify(input);const csv=huntProfileMatchesCsv(input,1,'tag',{kind:'value',firstRow:1});expect(csv.startsWith('\ufeff"query_position","profile_field"')).toBe(true);expect(csv).toContain('"2","tag","value","false","45","45","120","45"');expect(csv).toContain('"event.extra.present","event.extra.json"');expect(csv).toContain('"false",""\r\n');expect(csv).toContain('"true","null"');expect(csv.split('\r\n')).toHaveLength(47);expect(JSON.stringify(input)).toBe(before);
});
it('keeps missing separate from typed zero and null in CSV and validates selection before export',()=>{
 const input={rows:[{x:null},{id:2},{x:0},{x:'0'},{x:false}]};const csv=huntProfileMatchesCsv(input,0,'x',{kind:'missing'});expect(csv).toContain('"1","x","missing","","5","1","","2"');expect(csv.split('\r\n')).toHaveLength(3);expect(huntProfileMatchesCsv(input,0,'x',{kind:'value',firstRow:3})).toContain('"value","0","5","1"');for(const firstRow of [0,2,9,NaN])expect(()=>huntProfileMatchesCsv(input,0,'x',{kind:'value',firstRow})).toThrow();expect(()=>huntProfileMatchesCsv(input,-1,'x',{kind:'missing'})).toThrow();expect(()=>huntProfileMatchesCsv({rows:[{x:1}]},0,'x',{kind:'missing'})).toThrow();
});


it('exports all field coverage with exact counts types and unchanged recorded context without row values',()=>{
 const input={query:{sql:'SELECT *',params:{limit:100}},time_window:{since:'saved'},row_count:120,rows:[{x:null,tag:0},{x:false,tag:'0'},{tag:0},...Array.from({length:12},(_,i)=>({[`extra-${i}`]:i}))]},before=JSON.stringify(input);const value=JSON.parse(huntFieldCoverageJson(input,1,'time'));expect(value).toMatchObject({format:'onealert.retained-hunt-field-coverage',query_position:2,retained_total:15,exported_at:'time'});expect(value.fields).toHaveLength(14);expect(value.fields[0]).toEqual({field:'x',present:2,missing:13,recorded_null:1,distinct:2});expect(value.fields[1]).toEqual({field:'tag',present:3,missing:12,recorded_null:0,distinct:2});expect(value.query_context).toEqual({query:input.query,time_window:input.time_window,reported_row_count:120});expect(value.rows).toBeUndefined();expect(value.fields[0].values).toBeUndefined();expect(JSON.stringify(input)).toBe(before);
});
it('exports complete coverage CSV with protected field names and validates absent fields rows and query positions',()=>{
 const input={rows:[{'=field':null},{},{'=field':false}]};const csv=huntFieldCoverageCsv(input,0);expect(csv.startsWith('\ufeff"query_position"')).toBe(true);expect(csv).toContain('"1","3",""');expect(csv).toContain('"\'=field","2","1","1","2"');expect(csv.split('\r\n')).toHaveLength(3);expect(JSON.parse(huntFieldCoverageJson(input,0,'time')).query_context).toEqual({});for(const result of [{},{rows:[]},{rows:[{}]}]){expect(()=>huntFieldCoverageJson(result,0,'time')).toThrow();expect(()=>huntFieldCoverageCsv(result,0)).toThrow();}expect(()=>huntFieldCoverageCsv(input,-1)).toThrow();
});

it('exports all original inspected fields with recorded JSON types and query context without inferring absent fields',()=>{
 const row={z:false,A:0,optional:null,nested:{b:2,a:1},array:[2,1],empty:''};const value=JSON.parse(huntRowFieldsJson({rows:[{id:99},row],row_count:120,query:{sql:'SELECT * FROM security_events',params:{limit:100}}},1,2,'2026-11-27T00:00:00Z'));expect(value.format).toBe('onealert.retained-hunt-row-fields');expect(value.query_position).toBe(2);expect(value.retained_row_position).toBe(2);expect(value.retained_total).toBe(2);expect(value.recorded_field_count).toBe(6);expect(value.fields.map((field:{field:string;recorded_type:string})=>[field.field,field.recorded_type])).toEqual([['z','boolean'],['A','number'],['optional','null'],['nested','object'],['array','array'],['empty','string']]);expect(value.fields[3].value).toEqual({b:2,a:1});expect(value.query_context.reported_row_count).toBe(120);expect(value.query_context.query.params.limit).toBe(100);expect(value.query_context.rows).toBeUndefined();expect(JSON.parse(huntRowFieldsJson({rows:[{}]},0,1,'')).fields).toEqual([]);expect(()=>huntRowFieldsJson({rows:[{}]},0,2,'')).toThrow('Invalid retained row position');expect(()=>huntRowFieldsJson({rows:[{}]},-1,1,'')).toThrow('Invalid retained query position');
});
it('exports complete typed row fields as protected CSV including formula-like field names and raw JSON values',()=>{
 const row={' =SUM(A1)':'@raw,"quoted"\nnext',optional:null,zero:0,flag:false,nested:[2,1]};const csv=huntRowFieldsCsv({rows:[row],row_count:120},1,1);expect(csv.startsWith('\ufeff"query_position"')).toBe(true);expect(csv).toContain('"2","1","1","120","5"');expect(csv).toContain("\"' =SUM(A1)\"");expect(csv).toContain('"optional","null","null"');expect(csv).toContain('"zero","number","0"');expect(csv).toContain('"flag","boolean","false"');expect(csv).toContain('"nested","array","[2,1]"');expect(csv).toContain('""@raw,\\""quoted\\""\\nnext""');expect(huntRowFieldsCsv({rows:[{}]},0,1).split('\r\n')).toHaveLength(2);expect(()=>huntRowFieldsCsv({},0,1)).toThrow('Invalid retained row position');
});

 it('exports one exact compared field with full values, typed presence, original positions and no other row data',()=>{
  const result={row_count:120,query:{sql:'SELECT nested FROM security_events',params:{limit:2}},rows:[{nested:{flag:false,zero:0},secret:'PRIVATE_UNRELATED_VALUE',optional:null},{nested:{flag:true},other:'PRIVATE_UNRELATED_VALUE'}]};const value=JSON.parse(huntComparedFieldJson(result,0,1,2,'nested','fixed'));expect(value.format).toBe('onealert.retained-hunt-compared-field');expect(value.baseline_retained_position).toBe(1);expect(value.inspected_retained_position).toBe(2);expect(value.field.baseline).toEqual({flag:false,zero:0});expect(value.field.inspected).toEqual({flag:true});expect(value.field.status).toBe('Different recorded value');expect(value.query_context.reported_row_count).toBe(120);expect(value.query_context.rows).toBeUndefined();expect(JSON.stringify(value)).not.toContain('PRIVATE_UNRELATED_VALUE');const nullField=JSON.parse(huntComparedFieldJson(result,0,2,1,'optional','fixed'));expect(nullField.field.baselinePresent).toBe(false);expect(nullField.field).not.toHaveProperty('baseline');expect(nullField.field.inspectedPresent).toBe(true);expect(nullField.field.inspected).toBeNull();expect(nullField.field.status).toBe('Only in inspected row');
 });
 it('rejects unknown fields, same positions and invalid positions without inventing missing field evidence',()=>{
  const result={rows:[{'=field':false},{}]};expect(()=>huntComparedFieldJson(result,0,1,2,'missing','fixed')).toThrow();expect(()=>huntComparedFieldJson(result,0,1,1,'=field','fixed')).toThrow();expect(()=>huntComparedFieldJson(result,0,0,2,'=field','fixed')).toThrow();expect(JSON.parse(huntComparedFieldJson(result,0,1,2,'=field','fixed')).field.field).toBe('=field');
 });

it('exports one compared field CSV with swapped positions, presence, exact JSON and formula-safe field name',()=>{
 const result={row_count:120,rows:[{'=formula':{flag:false,zero:0},private:'not-this-field'},{optional:null}]};const csv=huntComparedFieldCsv(result,0,2,1,'=formula');expect(csv.startsWith('\ufeff"query_position"')).toBe(true);expect(csv.split('\r\n')).toHaveLength(3);expect(csv).toContain('"1","2","1","2","120"');expect(csv).toContain('"\'=formula","Only in inspected row","false","","true","{');expect(csv).toContain('""flag"":false');expect(csv).not.toContain('not-this-field');expect(()=>huntComparedFieldCsv(result,0,1,2,'missing')).toThrow();expect(()=>huntComparedFieldCsv(result,0,0,2,'=formula')).toThrow();const nullCsv=huntComparedFieldCsv(result,0,1,2,'optional');expect(nullCsv).toContain('"optional","Only in inspected row","false","","true","null"');
});

it('exports one canonical typed profile value and frequency without other values or row fields',()=>{
 const result={query:{sql:'SELECT value'},row_count:100,rows:[{value:{n:0,b:false},secret:'PRIVATE_OTHER_FIELD'},{value:{b:false,n:0}},{value:0},{value:'PRIVATE_OTHER_VALUE'},{}]};const item=JSON.parse(huntProfileValueJson(result,1,'value',1,'stamp'));expect(item).toMatchObject({format:'onealert.retained-hunt-profile-value',version:1,exported_at:'stamp',query_position:2,field:'value',retained_total:5,matching_retained_count:2,first_retained_position:1,recorded_type:'object',value:{n:0,b:false},query_context:{reported_row_count:100}});expect(item.query_context.rows).toBeUndefined();expect(JSON.stringify(item)).not.toMatch(/PRIVATE_OTHER/);for(const position of [0,2,5,6,1.5,NaN])expect(()=>huntProfileValueJson(result,0,'value',position,'')).toThrow();expect(()=>huntProfileValueJson(result,0,'missing',1,'')).toThrow();expect(()=>huntProfileValueJson({rows:[]},0,'value',1,'')).toThrow();
});
it('preserves null false zero arrays strings and formula-like text in single profile JSON',()=>{
 for(const value of [null,false,0,[],['x'], '=SUM(A1)']){const item=JSON.parse(huntProfileValueJson({rows:[{value},{}]},0,'value',1,''));expect(item.value).toEqual(value);expect(item.matching_retained_count).toBe(1);expect(item.recorded_type).toBe(value===null?'null':Array.isArray(value)?'array':typeof value);}
});

it('exports one typed profile CSV record with canonical frequency and no unrelated row fields',()=>{
 const result={row_count:100,query:{sql:'PRIVATE_QUERY'},rows:[{'=field':{x:0,y:false},secret:'PRIVATE_FIELD'},{'=field':{y:false,x:0}},{'=field':'PRIVATE_OTHER_VALUE'}]};const csv=huntProfileValueCsv(result,2,'=field',1);expect(csv.startsWith('\ufeff')).toBe(true);expect(csv.split('\r\n')).toHaveLength(3);expect(csv).toContain('"3","\'=field","object","{""x"":0,""y"":false}","2","3","1","100"');expect(csv).not.toMatch(/PRIVATE_/);expect(csv).toContain('Full query context is available in JSON only');for(const pos of [0,2,4,1.5])expect(()=>huntProfileValueCsv(result,0,'=field',pos)).toThrow();
});
it('keeps typed null false zero and formula-like string JSON intact in profile CSV',()=>{
 for(const [value,encoded] of [[null,'"null","null"'],[false,'"boolean","false"'],[0,'"number","0"'],['=SUM(A1)','"string","""=SUM(A1)"""']]){const csv=huntProfileValueCsv({rows:[{value},{}]},0,'value',1);expect(csv).toContain(encoded);expect(csv).toContain('"1","2","1"');}
 const csv=huntProfileValueCsv({rows:[{' \t+field':'a,"b"\nc'}]},0,' \t+field',1);expect(csv).toContain('"\' \t+field"');expect(csv.split('\r\n')).toHaveLength(3);
});

it('exports every focused profile value page with exact focus and full retained context but no source rows',()=>{
 const rows=[...Array.from({length:13},(_,i)=>({value:i,secret:'PRIVATE_FIELD'})),{value:0},{value:'PRIVATE_OTHER_VALUE'},{}];const review={search:'',type:'number',frequency:'once',order:'retained'};const item=JSON.parse(huntProfileReviewJson({rows,row_count:500},2,'value',review,'stamp'));expect(item).toMatchObject({format:'onealert.retained-hunt-profile-review',version:1,exported_at:'stamp',query_position:3,field:'value',review,full_retained_summary:{total:16,present:15,missing:1,recorded_null:0,distinct:14},matching_distinct_count:12,matching_retained_count:12,query_context:{reported_row_count:500}});expect(item.values).toHaveLength(12);expect(item.values[0]).toEqual({value:1,count:1,firstRow:2});expect(item.values.at(-1).value).toBe(12);expect(item.query_context.rows).toBeUndefined();expect(JSON.stringify(item)).not.toMatch(/PRIVATE_/);
});
it('keeps canonical frequencies types null and stable ordering in profile review exports',()=>{
 const rows=[{v:{n:0,b:false}},{v:{b:false,n:0}},{v:null},{v:false},{v:0},{v:'0'},{v:[0]},{v:[0]},{}];const review={search:'  N  ',type:'object',frequency:'repeated',order:'rare'};const item=JSON.parse(huntProfileReviewJson({rows},0,'v',review,''));expect(item.review).toEqual(review);expect(item.values).toEqual([{value:{n:0,b:false},count:2,firstRow:1}]);const zero=JSON.parse(huntProfileReviewJson({rows},0,'v',{search:'0',type:'number',frequency:'once',order:'frequent'},''));expect(zero.values).toEqual([{value:0,count:1,firstRow:5}]);const none=JSON.parse(huntProfileReviewJson({rows},0,'v',{search:'nothing',type:'all',frequency:'all',order:'frequent'},''));expect(none.values).toEqual([]);expect(none.matching_retained_count).toBe(0);for(const change of [{type:'missing'},{frequency:'0'},{order:'name'}])expect(()=>huntProfileReviewJson({rows},0,'v',{...review,...change},'')).toThrow();expect(()=>huntProfileReviewJson({rows},-1,'v',review,'')).toThrow();expect(()=>huntProfileReviewJson({rows},0,'absent',review,'')).toThrow();
});

it('exports focused profile CSV across pages with full summary and explicit empty match record',()=>{
 const rows=[...Array.from({length:13},(_,i)=>({v:i,private:'PRIVATE_FIELD'})),{v:0},{v:'PRIVATE_VALUE'},{}];const review={search:'',type:'number',frequency:'once',order:'retained'};const csv=huntProfileReviewCsv({rows,row_count:500},1,'v',review);expect(csv.startsWith('\ufeff')).toBe(true);expect(csv.split('\r\n')).toHaveLength(14);expect(csv).toContain('"2","v","","number","once","retained","16","15","1","0","14","12","12","500","true","number","1","1","2"');expect(csv).not.toMatch(/PRIVATE_/);const empty=huntProfileReviewCsv({rows},0,'v',{...review,search:'=none'});expect(empty.split('\r\n')).toHaveLength(3);expect(empty).toContain('"\'=none"');expect(empty).toContain('"0","0","","false","","","",""');
});
it('keeps recorded null distinct from empty review and escapes multiline formula-like names',()=>{
 const csv=huntProfileReviewCsv({rows:[{'=v':null},{'=v':null},{}]},0,'=v',{search:'',type:'null',frequency:'repeated',order:'frequent'});expect(csv).toContain('"\'=v"');expect(csv).toContain('"true","null","null","2","1"');const object=huntProfileReviewCsv({rows:[{v:{a:0,b:false}},{v:{b:false,a:0}}]},0,'v',{search:'',type:'object',frequency:'repeated',order:'rare'});expect(object).toContain('"{""a"":0,""b"":false}","2","1"');expect(()=>huntProfileReviewCsv({rows:[{v:0}]},0,'v',{search:'',type:'bad',frequency:'all',order:'frequent'})).toThrow();
});

it('exports all represented original rows across pages with full recorded fields and exact review context',()=>{
 const rows=[...Array.from({length:25},(_,i)=>({v:i,secret:i===24?'LAST_RECORDED':false})),{v:0,nested:{x:null}},{v:'NONMATCHING_PRIVATE'},{}];const review={search:'',type:'number',frequency:'all',order:'rare'};const item=JSON.parse(huntProfileReviewRowsJson({rows,row_count:500},1,'v',review,'stamp'));expect(item).toMatchObject({format:'onealert.retained-hunt-profile-review-rows',version:1,exported_at:'stamp',query_position:2,review,matching_distinct_count:25,matching_retained_count:26,query_context:{reported_row_count:500}});expect(item.rows).toHaveLength(26);expect(item.rows.map((r:{retained_row_position:number})=>r.retained_row_position)).toEqual(Array.from({length:26},(_,i)=>i+1));expect(item.rows[24].row.secret).toBe('LAST_RECORDED');expect(item.rows[25].row.nested).toEqual({x:null});expect(item.values[0].firstRow).toBe(2);expect(item.query_context.rows).toBeUndefined();expect(JSON.stringify(item)).not.toContain('NONMATCHING_PRIVATE');
});
it('distinguishes null canonical objects and empty represented rows without inferring missing values',()=>{
 const rows=[{v:{a:0,b:false}},{v:null},{v:{b:false,a:0}},{v:false},{}];const review={search:'',type:'object',frequency:'repeated',order:'frequent'};expect(JSON.parse(huntProfileReviewRowsJson({rows},0,'v',review,'')).rows.map((r:{retained_row_position:number})=>r.retained_row_position)).toEqual([1,3]);expect(JSON.parse(huntProfileReviewRowsJson({rows},0,'v',{...review,type:'null',frequency:'all'},'')).rows).toEqual([{retained_row_position:2,row:{v:null}}]);const empty=JSON.parse(huntProfileReviewRowsJson({rows},0,'v',{...review,search:'nothing'},''));expect(empty.rows).toEqual([]);expect(empty.matching_retained_count).toBe(0);expect(()=>huntProfileReviewRowsJson({rows},0,'v',{...review,type:'missing'},'')).toThrow();
});
