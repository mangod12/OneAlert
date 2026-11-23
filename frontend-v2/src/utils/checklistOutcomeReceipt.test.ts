import { expect, it } from 'vitest';
import { checklistOutcomeCsv, checklistOutcomeReceipt } from './checklistOutcomeReceipt';
const tasks = Array.from({ length: 3 }, (_, index) => ({ id: index + 1, title: `Task ${index + 1}`, done: false, position: index, assignee_id: null, due_date: null, completed_at: null }));
it('distinguishes exact confirmed, uncertain and unattempted tasks', () => {
  const receipt = checklistOutcomeReceipt(7, { id: 5, email: 'owner@example.test' }, 'Mark complete', tasks, [{ ...tasks[0], done: true }], new Set([1, 2]), '2026-11-24T00:00:00Z');
  expect(receipt.rows.map(row => row.outcome)).toEqual(['confirmed', 'unconfirmed', 'not_attempted']); expect(receipt.rows[0].after?.done).toBe(true); expect(receipt.rows[1].after).toBeNull(); expect(receipt.rows[2].after).toBeNull(); expect(receipt.rows[0].before.done).toBe(false);
});
it('account preflight failure leaves every task unattempted', () => {
  const receipt = checklistOutcomeReceipt(7, { id: 5, email: 'owner@example.test' }, 'Mark complete', tasks, [], new Set(), '2026-11-24T00:00:00Z'); expect(receipt.rows.every(row => row.outcome === 'not_attempted')).toBe(true);
});
it('copies task and actor values instead of holding mutable references', () => {
  const source = [{ ...tasks[0] }], account = { id: 5, email: 'owner@example.test' }; const receipt = checklistOutcomeReceipt(7, account, 'Mark complete', source, [], new Set(), '2026-11-24T00:00:00Z'); source[0].title = 'Changed'; account.email = 'changed@example.test'; expect(receipt.rows[0].title).toBe('Task 1'); expect(receipt.rows[0].before.title).toBe('Task 1'); expect(receipt.account.email).toBe('owner@example.test');
});
it.each(['=HYPERLINK("bad")', '+SUM(1,2)', '-1+2', '@SUM(1)', '   =bad', '\tbad', '\nbad'])('escapes spreadsheet formulas and control prefixes %s', title => {
  const receipt = checklistOutcomeReceipt(7, { id: 5, email: 'owner@example.test' }, 'Mark complete', [{ ...tasks[0], title }], [], new Set(), '2026-11-24T00:00:00Z'); const csv = checklistOutcomeCsv(receipt); expect(csv).toContain('"\'' + title.replaceAll('"', '""') + '"');
});
it('exports stable scope, exact identities, multiline titles and blank unknown results', () => {
  const receipt = checklistOutcomeReceipt(7, { id: 5, email: 'owner@example.test' }, 'Set due date', [{ ...tasks[0], title: 'Exact, "quoted"\nsecond line' }], [], new Set([1]), '2026-11-24T00:00:00Z'); const csv = checklistOutcomeCsv(receipt); expect(csv.startsWith('\uFEFF')).toBe(true); expect(csv).toContain('"unconfirmed","false","","","","",""'); expect(csv).toContain('not current state'); expect(csv).toContain('Exact, ""quoted""\nsecond line');
});
