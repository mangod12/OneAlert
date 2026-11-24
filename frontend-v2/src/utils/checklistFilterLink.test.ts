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
