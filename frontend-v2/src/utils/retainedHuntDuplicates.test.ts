import { describe, expect, it } from 'vitest';
import { huntRepeatedRowsCsv, huntRepeatedRowsJson, retainedHuntDuplicateGroups, retainedHuntUniquePositions, huntUniqueRowsJson } from './retainedHuntDuplicates';

describe('Repeated full retained row values', () => {
  it('groups entire typed rows in original first-position order without mutating evidence', () => {
    const rows = [{ id: 1, nested: { b: false, a: 0 } }, { id: 2 }, { nested: { a: 0, b: false }, id: 1 }, { id: 2 }, { id: 3 }];
    const before = JSON.stringify(rows);
    expect(retainedHuntDuplicateGroups(rows)).toEqual([[1, 3], [2, 4]]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('distinguishes absence, null, false, zero, empty text and nested array order', () => {
    expect(retainedHuntDuplicateGroups([{}, { a: null }, { a: false }, { a: 0 }, { a: '' }, { a: [1, 2] }, { a: [2, 1] }, {}, { a: null }])).toEqual([[1, 8], [2, 9]]);
  });
  it('does not group rows by shared IDs alone and handles empty and unique evidence', () => {
    expect(retainedHuntDuplicateGroups([{ id: 1, value: 'a' }, { id: 1, value: 'b' }])).toEqual([]);
    expect(retainedHuntDuplicateGroups([])).toEqual([]);
  });
});

it('exports every repeated group with original positions and full recorded query context without unrelated unique rows',()=>{
 const rows=[{id:1,nested:{b:false,a:0},raw:'=SUM(A1)'},{id:2,unique:'private'},{raw:'=SUM(A1)',nested:{a:0,b:false},id:1}];const value=JSON.parse(huntRepeatedRowsJson({rows,row_count:120,query:{sql:'SELECT id FROM security_events',params:{limit:100}},time_window:{since:'2026-11-20T00:00:00Z'}},2,'2026-11-27T00:00:00Z'));expect(value.format).toBe('onealert.retained-hunt-repeated-rows');expect(value.query_position).toBe(3);expect(value.retained_total).toBe(3);expect(value.repeated_group_count).toBe(1);expect(value.repeated_position_count).toBe(2);expect(value.groups).toEqual([{first_retained_position:1,retained_count:2,retained_positions:[1,3],row:rows[0]}]);expect(value.query_context.reported_row_count).toBe(120);expect(value.query_context.query.params.limit).toBe(100);expect(value.query_context.time_window.since).toBe('2026-11-20T00:00:00Z');expect(value.query_context.rows).toBeUndefined();expect(JSON.stringify(value)).not.toContain('private');
});
it('exports explicit zero groups without inventing missing rows or context and validates query positions',()=>{
 const value=JSON.parse(huntRepeatedRowsJson({},0,''));expect(value.retained_total).toBe(0);expect(value.repeated_group_count).toBe(0);expect(value.repeated_position_count).toBe(0);expect(value.groups).toEqual([]);expect(value.query_context).toEqual({});expect(()=>huntRepeatedRowsJson({},-1,'')).toThrow('Invalid retained query position');
});

it('exports every repeated group as typed row JSON with exact positions and CSV escaping',()=>{
 const row={id:1,raw:'=SUM(A1),"quoted"\nnext',flag:false,zero:0,optional:null,nested:[2,1]};const csv=huntRepeatedRowsCsv({rows:[row,{id:2},row],row_count:120},1);expect(csv.startsWith('\ufeff"query_position"')).toBe(true);expect(csv).toContain('"2","3","120","1","2","1","2","[1,3]"');expect(csv).toContain('""raw"":""=SUM(A1),\\""quoted\\""\\nnext""');expect(csv).toContain('""flag"":false');expect(csv).toContain('""zero"":0');expect(csv).toContain('""optional"":null');expect(csv).toContain('""nested"":[2,1]');expect(csv).not.toContain('event.id');
});
it('exports a header only for unique evidence and validates query position',()=>{
 expect(huntRepeatedRowsCsv({rows:[{id:1}]},0).split('\r\n')).toHaveLength(2);expect(()=>huntRepeatedRowsCsv({},-1)).toThrow('Invalid retained query position');
});

it('finds once-occurring complete typed values without treating shared IDs as equal or mutating evidence',()=>{
 const rows=[{id:1,nested:{b:0,a:false}},{id:1,value:'other'},{nested:{a:false,b:0},id:1},{a:null},{},{a:[1,2]},{a:[2,1]},{a:false},{a:0},{a:''}];const before=JSON.stringify(rows);expect(retainedHuntUniquePositions(rows)).toEqual([2,4,5,6,7,8,9,10]);expect(JSON.stringify(rows)).toBe(before);expect(retainedHuntUniquePositions([])).toEqual([]);expect(retainedHuntUniquePositions([{},{}])).toEqual([]);
});
it('exports all once-occurring raw rows with positions and recorded context but excludes repeated groups',()=>{
 const rows=[{id:1},{id:2,raw:'=SUM(A1)',nested:{flag:false},optional:null},{id:1}];const value=JSON.parse(huntUniqueRowsJson({rows,row_count:120,query:{sql:'SELECT id FROM security_events',params:{limit:100}},time_window:{since:'2026-11-20T00:00:00Z'}},1,'2026-11-27T00:00:00Z'));expect(value.format).toBe('onealert.retained-hunt-unique-rows');expect(value.query_position).toBe(2);expect(value.retained_total).toBe(3);expect(value.unique_full_row_count).toBe(1);expect(value.rows).toEqual([{retained_position:2,row:rows[1]}]);expect(value.query_context.reported_row_count).toBe(120);expect(value.query_context.query.params.limit).toBe(100);expect(value.query_context.time_window.since).toBe('2026-11-20T00:00:00Z');expect(value.query_context.rows).toBeUndefined();expect(JSON.parse(huntUniqueRowsJson({},0,'')).rows).toEqual([]);expect(()=>huntUniqueRowsJson({},-1,'')).toThrow('Invalid retained query position');
});
