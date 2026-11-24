import { expect, it } from 'vitest';
import { readWorkloadView, savedWorkloadFilters, type WorkloadFilters } from './assignedWorkloadViews';
const filters: WorkloadFilters = { sort: 'priority', query: 'gateway', severity: 'high', due: 'range', today: '2026-11-24', completion: 'all', investigations: 'all', dueFrom: '2026-11-20', dueThrough: '2026-11-24', investigationId: 7 };
it('roundtrips exact applied criteria including fixed inclusive dates and exact investigation', () => { expect(readWorkloadView(savedWorkloadFilters(filters))).toEqual(filters); });
it('omits stale unused window drafts and null investigation scope', () => { const value = savedWorkloadFilters({ ...filters, due: 'all', investigationId: null }); expect(value).not.toHaveProperty('dueFrom'); expect(value).not.toHaveProperty('investigationId'); expect(readWorkloadView(value)).toEqual({ ...filters, due: 'all', dueFrom: '', dueThrough: '', investigationId: null }); });
it.each([null, [], {}, { ...filters, query: 'x'.repeat(201) }, { ...filters, dueFrom: '2026-02-30' }, { ...filters, dueThrough: '2026-11-19' }, { ...filters, today: '2026-02-30' }, { ...filters, due: 'today' }, { ...filters, severity: 'urgent' }, { ...filters, completion: 'yes' }, { ...filters, investigations: 'hidden' }, { ...filters, investigationId: '7' }, { ...filters, investigationId: 0 }, { ...filters, investigationId: true }, { ...filters, page: 2 }, { ...filters, tasks: [] }])('rejects invalid or record-bearing view %j', value => { expect(readWorkloadView(value)).toBeNull(); });
it('restores legacy views with default priority order and roundtrips every explicit sort', () => {
  const legacy = { ...filters }; delete legacy.sort; expect(readWorkloadView(legacy)?.sort).toBe('priority');
  for (const sort of ['priority', 'task_due', 'completed_newest', 'title']) expect(readWorkloadView(savedWorkloadFilters({ ...filters, sort }))?.sort).toBe(sort);
  expect(readWorkloadView({ ...filters, sort: 'arbitrary' })).toBeNull();
});
