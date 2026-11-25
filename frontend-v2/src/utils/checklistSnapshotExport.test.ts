import { expect, it } from 'vitest';
import { checklistExportSnapshot, checklistSnapshotCsv, checklistSnapshotJson, checklistExportEvidenceValid } from './checklistSnapshotExport';
import { defaultChecklistFilters } from './checklistTriage';
const task = { id: 7, title: 'Endpoint, "evidence"\nreview', done: false, position: 2, due_date: null, assignee_id: 99 };
it('freezes exact matching rows and filters without following later changes', () => {
  const row = { ...task }, filters = { ...defaultChecklistFilters, status: 'open' };
  const snapshot = checklistExportSnapshot(12, [row], 23, filters, '2026-11-24', 'captured');
  row.title = 'Changed'; filters.status = 'done';
  expect(snapshot.tasks[0].title).toBe(task.title); expect(snapshot.filters.status).toBe('open');
  const csv = checklistSnapshotCsv(snapshot); expect(csv).toContain('Endpoint, ""evidence""\nreview'); expect(csv).toContain('"12","captured","2026-11-24","23","1"'); expect(csv).toContain('"7"'); expect(csv).toContain('"99"'); expect(csv).toContain('not freshly fetched');
});
it.each(['=SUM(A1)', '+12', '-5', '@cmd', '\t=cmd', '\u0000 =cmd', '\r\n@cmd', '  +cmd'])('escapes formula-like titles and filters %s', title => {
  const csv = checklistSnapshotCsv(checklistExportSnapshot(12, [{ ...task, title }], 1, { ...defaultChecklistFilters, query: title }, '', 'now'));
  expect(csv.split('"\'' + title + '"')).toHaveLength(3);
});
it('keeps unassigned null separate from named account IDs and preserves completed state', () => {
  const csv = checklistSnapshotCsv(checklistExportSnapshot(12, [{ ...task, done: true, assignee_id: null }], 1, defaultChecklistFilters, '', 'now'));
  expect(csv).toContain('"true","","","2"');
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid investigation scope %s', id => expect(() => checklistExportSnapshot(id, [task], 1, defaultChecklistFilters, '', 'now')).toThrow());
it('rejects fewer loaded tasks than reviewed rows', () => expect(() => checklistExportSnapshot(12, [task], 0, defaultChecklistFilters, '', 'now')).toThrow());
it('exports exact fixed date-window metadata alongside the reviewed filter', () => {
  const csv = checklistSnapshotCsv(checklistExportSnapshot(12, [task], 1, { ...defaultChecklistFilters, due: 'range', dueFrom: '2026-11-20', dueTo: '2026-11-24' }, '', 'now'));
  expect(csv).toContain('"due_window_from","due_window_through"');
  expect(csv).toContain('"2026-11-20","2026-11-24"');
});

it('exports versioned frozen matching rows with typed values and only allowlisted fields', () => {
 const row = { ...task, title: '=SUM(A1)', done: true, assignee_id: null, secret: 'excluded' }, filters = { ...defaultChecklistFilters, query: '=literal', dueFrom: 'stale', dueTo: 'draft' };
 const snapshot = checklistExportSnapshot(12, [row], 23, filters, '', 'captured'); row.title = 'Changed'; filters.query = 'Changed';
 const value = JSON.parse(checklistSnapshotJson(snapshot));
 expect(value.format).toBe('onealert.checklist-snapshot'); expect(value.version).toBe(1); expect(value.investigation_id).toBe(12); expect(value.loaded_task_count).toBe(23); expect(value.captured_task_count).toBe(1); expect(value.local_date_for_filters).toBeNull();
 expect(value.filters.query).toBe('=literal'); expect(value.filters.due_from).toBeNull(); expect(value.filters.due_through).toBeNull();
 expect(value.tasks).toEqual([{ task_id: 7, title: '=SUM(A1)', completed: true, due_date: null, assignee_id: null, checklist_position: 2 }]);
 expect(JSON.stringify(value)).not.toContain('excluded'); expect(JSON.stringify(value)).not.toContain('Changed');
});
it('preserves fixed filter dates and exact assignee selection in JSON without inferring account details', () => {
 const snapshot = checklistExportSnapshot(12, [task], 1, { ...defaultChecklistFilters, assignee: '99', due: 'range', dueFrom: '2026-11-20', dueTo: '2026-11-24' }, '2026-11-24', 'now');
 const value = JSON.parse(checklistSnapshotJson(snapshot)); expect(value.filters.due_from).toBe('2026-11-20'); expect(value.filters.due_through).toBe('2026-11-24'); expect(value.filters.assignee).toBe('99'); expect(value.tasks[0].assignee_id).toBe(99); expect(value.local_date_for_filters).toBe('2026-11-24');
});

it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid loaded counts %s before capturing evidence', count => {
 expect(checklistExportEvidenceValid(12, [task], count)).toBe(false); expect(() => checklistExportSnapshot(12, [task], count, defaultChecklistFilters, '', '')).toThrow();
});
it.each([
 { id: 0 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { title: null }, { done: 'false' }, { position: -1 }, { position: 0.5 }, { assignee_id: 0 }, { assignee_id: '99' }, { due_date: 20261125 },
])('refuses malformed task evidence rather than creating misleading JSON/CSV %j', invalid => {
 const rows = [{ ...task, ...invalid }] as unknown as typeof task[]; expect(checklistExportEvidenceValid(12, rows, 1)).toBe(false); expect(() => checklistExportSnapshot(12, rows, 1, defaultChecklistFilters, '', '')).toThrow();
});
it('rejects duplicated task IDs without silently deduplicating or substituting rows', () => {
 expect(checklistExportEvidenceValid(12, [task, { ...task, title: 'Different' }], 2)).toBe(false); expect(() => checklistExportSnapshot(12, [task, task], 2, defaultChecklistFilters, '', '')).toThrow();
});
it('accepts raw invalid calendar text as saved evidence, not a valid date or lateness claim', () => {
 const rows = [{ ...task, due_date: 'not-a-date', position: 0, assignee_id: null }]; expect(checklistExportEvidenceValid(12, rows, 1)).toBe(true); const value = JSON.parse(checklistSnapshotJson(checklistExportSnapshot(12, rows, 1, defaultChecklistFilters, '', ''))); expect(value.tasks[0].due_date).toBe('not-a-date'); expect(value.tasks[0].assignee_id).toBeNull();
});
