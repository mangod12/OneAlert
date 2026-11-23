import { beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { checkedBatchReview, saveReviewedBatchTask } from './reviewedChecklistBatch';
vi.mock('../api/client', () => ({ default: { patch: vi.fn() } }));
const account = { id: 5, email: 'owner@example.test', role: 'analyst', org_id: 7 };
const task = { id: 9, title: 'Exact saved task', done: false, due_date: null, assignee_id: null, position: 2, completed_at: null };
const preview = { case_id: 7, owner_id: 5, assigned_to_id: null, title: 'Exact case', status: 'open', severity: 'high', task, proposed_done: true, reviewed_fingerprint: 'a'.repeat(64) };
beforeEach(() => vi.resetAllMocks());
it.each([{ task: { ...task, title: 'Changed' } }, { task: { ...task, done: true } }, { case_id: 8 }, { owner_id: 8 }, { proposed_done: false }, { reviewed_fingerprint: 'bad' }, { task: { ...task, assignee_id: 8 } }, { task: { ...task, position: 9 } }])('rejects stale or mismatched preview %#', change => {
  expect(() => checkedBatchReview({ ...preview, ...change }, task, 7, { done: true }, account)).toThrow();
});
it('checks proposed due date and discloses reminder effects', () => {
  const row = checkedBatchReview({ ...preview, proposed_due_date: '2027-01-02' }, task, 7, { due_date: '2027-01-02' }, account); expect(row.endpoint).toBe('due'); expect(row.effects).toContain('Reminder markers reset');
});
it.each([{ title: 'Wrong' }, { due_date: '2027-01-01' }, { assignee_id: 8 }, { position: 0 }, { case_id: 8 }, { done: false }])('rejects mismatched success receipt %#', async change => {
  const row = checkedBatchReview(preview, task, 7, { done: true }, account); vi.mocked(apiClient.patch).mockResolvedValue({ status: 200, data: { ...task, case_id: 7, done: true, ...change } }); await expect(saveReviewedBatchTask(row, 7)).rejects.toThrow();
});
it('rejects assignment evidence with the wrong org or notification effects', () => {
  const data = { ...preview, proposed_assignee_id: 6, proposed_assignee: { id: 6, email: 'recipient@example.test', org_id: 8, is_active: true }, target_existing_access_reasons: [], retained_access_reasons: [], assignment_notification: true, grants_investigation_access: true };
  expect(() => checkedBatchReview(data, task, 7, { assignee_id: 6 }, account)).toThrow(); expect(() => checkedBatchReview({ ...data, proposed_assignee: { ...data.proposed_assignee, org_id: 7 }, assignment_notification: false }, task, 7, { assignee_id: 6 }, account)).toThrow();
});
