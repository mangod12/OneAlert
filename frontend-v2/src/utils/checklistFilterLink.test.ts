import { expect, it } from 'vitest';
import { checklistFilterLink, readChecklistFilterLink } from './checklistFilterLink';
import { defaultChecklistFilters } from './checklistTriage';
it('copies exact filter values and account rather than viewer-relative mine or unrelated context', () => {
  const filters = { query: 'Private + endpoint & "host"', status: 'open', assignee: 'mine', due: 'overdue', sort: 'due' };
  const url = new URL(checklistFilterLink('https://example.test', 7, filters, 99));
  expect(url.pathname).toBe('/app/cases/7'); expect(url.hash).toBe(''); expect([...url.searchParams.keys()]).toHaveLength(6);
  expect(readChecklistFilterLink(url.search)).toEqual({ filters: { ...filters, assignee: '99' }, invalid: false });
});
it.each(['checklist=1&checklist=1', 'checklist=1&checklist_status=open&checklist_status=done', 'checklist=0', 'checklist_status=open', 'checklist=1&task=7', 'checklist=1&checklist_assignee=mine', 'checklist=1&checklist_assignee=0', 'checklist=1&checklist_assignee=1.5', 'checklist=1&checklist_assignee=9007199254740992', 'checklist=1&checklist_status=invalid', 'checklist=1&checklist_due=invalid', 'checklist=1&checklist_sort=invalid', `checklist=1&checklist_query=${'x'.repeat(201)}`])('rejects invalid or ambiguous scopes %s', query => expect(readChecklistFilterLink(query).invalid).toBe(true));
it('uses defaults only when no filter handoff is present and permits exact unknown member IDs', () => {
  expect(readChecklistFilterLink('?note=7')).toEqual({ filters: defaultChecklistFilters, invalid: false });
  expect(readChecklistFilterLink('?checklist=1&checklist_assignee=999').filters.assignee).toBe('999');
});
it('fails rather than broadens mine when current account is unavailable', () => expect(() => checklistFilterLink('https://example.test', 7, { ...defaultChecklistFilters, assignee: 'mine' }, null)).toThrow());
it.each([0, -1, 1.5])('rejects bad case IDs %s', id => expect(() => checklistFilterLink('https://example.test', id, defaultChecklistFilters, 5)).toThrow());
it('roundtrips exact fixed date boundaries without converting them to a relative date bucket', () => {
  const filters = { ...defaultChecklistFilters, due: 'range', dueFrom: '2026-11-20', dueTo: '2026-12-01' };
  expect(readChecklistFilterLink(new URL(checklistFilterLink('https://example.test', 7, filters, 5)).search)).toEqual({ filters, invalid: false });
});
it.each(['checklist=1&checklist_due=range', 'checklist=1&checklist_due=range&checklist_from=2026-11-24&checklist_to=2026-11-20', 'checklist=1&checklist_due=range&checklist_from=2026-02-30&checklist_to=2026-11-20', 'checklist=1&checklist_from=2026-11-20', 'checklist=1&checklist_due=range&checklist_from=2026-11-20&checklist_from=2026-11-21&checklist_to=2026-11-24'])('rejects malformed fixed window link %s', search => expect(readChecklistFilterLink(search).invalid).toBe(true));
