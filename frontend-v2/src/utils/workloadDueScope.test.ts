import { expect, it } from 'vitest';
import { workloadDueScopeMatches } from './workloadDueScope';
const filters = { due: 'all', today: '2026-11-25', dueFrom: '2026-11-20', dueThrough: '2026-11-25' };
it.each([
 ['none',null,true],['none','',false],['none','2026-11-25',false],
 ['overdue','2026-11-24',true],['overdue','2026-11-25',false],['overdue',null,false],
 ['today','2026-11-25',true],['today','2026-11-24',false],['today','2026-11-25T00:00:00Z',false],
 ['future','2026-11-26',true],['future','2026-11-25',false],['future','2026-11-31',false],
 ['range','2026-11-20',true],['range','2026-11-25',true],['range','2026-11-26',false],['all',null,true],['all','',true],
] as const)('verifies %s against exact recorded date %s', (due,value,expected) => expect(workloadDueScopeMatches(value,{...filters,due})).toBe(expected));
it('rejects invalid or reversed boundaries and unknown due buckets without assigning dates',()=>{
 expect(workloadDueScopeMatches('2026-11-25',{...filters,due:'today',today:'invalid'})).toBe(false);
 expect(workloadDueScopeMatches('2026-11-25',{...filters,due:'range',dueFrom:'2026-11-26'})).toBe(false);
 expect(workloadDueScopeMatches('2026-11-25',{...filters,due:'other'})).toBe(false);
});
