import { describe, expect, it } from 'vitest';
import { caseHandoff, type HandoffSnapshot } from './caseHandoff';
const snapshot: HandoffSnapshot = {
  investigation: { id: 7, title: 'Case\nsecond line', status: 'open', severity: 'high', timeline: [] },
  tasks: [{ id: 1, title: 'Pending', done: false, assignee_id: 5, due_date: '2026-11-24' }, { id: 2, title: 'Finished', done: true }],
  alerts: [{ id: 8, title: 'Alert', severity: 'high', cve_id: 'CVE-2026-1234' }],
  events: [{ id: 9, event_type: 'network', severity: 'low', signature: 'Signature' }],
  capturedAt: '2026-11-19T17:00:00Z',
};
describe('caseHandoff', () => {
  it('separates open and completed tasks and preserves recorded ownership and dates', () => {
    const text = caseHandoff(snapshot, false);
    expect(text).toContain('OPEN TASKS (1)\nTask #1 | Assignee user ID: 5 | Due: 2026-11-24\n  Pending');
    expect(text).toContain('COMPLETED TASKS (1)\nTask #2\n  Finished');
    expect(text).toContain('Case\n  second line');
    expect(text).toContain('CVE-2026-1234');
    expect(text).toContain('Signature');
    expect(text).toContain('not an atomic snapshot');
  });
  it('does not mistake an empty checklist for completed investigation work', () => {
    const text = caseHandoff({ ...snapshot, tasks: [] }, false);
    expect(text).toContain('This does not establish that all investigation work is finished.');
    expect(text).toContain('TIMELINE OMITTED BY REVIEWER');
    expect(text).toContain('Unassigned or unavailable');
    expect(text).toContain('full alert/event bodies and network graphs are not included.');
  });
});

it('includes only the selected plan page with explicit mode, missing evidence and no plan actor fields', () => {
  const plan = { id: 21, case_id: 7, status: 'partial', autonomy_level: 'L1', created_at: '2026-11-20T00:00:00Z', created_by: 'private-plan-actor', approved_by: 77, actions: [
    { action_type: 'notify', target: 'soc', reason: 'Recorded reason\nsecond line', priority: 0, policy_check: { approved: false }, execution_result: { status: 'completed', execution_mode: 'simulated', detail: 'Recorded detail', executed_at: '2026-11-20T18:00:00+05:30' } },
    { action_type: 'isolate_host', target: 'gateway', reason: 'No result' },
  ] };
  const text = caseHandoff({ ...snapshot, responsePlans: { plans: [plan], page: 2, size: 10, total: 21, fetchedAt: '2026-11-21T00:00:00Z' } }, false);
  expect(text).toContain('Plan page: 2 of 3 | Page size: 10 | Total visible matching plan records: 21');
  expect(text).toContain('Recorded priority: 0'); expect(text).toContain('Recorded policy approval flag: false');
  expect(text).toContain('Simulated, no external action performed'); expect(text).toContain('Not verified, external action not established');
  expect(text).toContain('Recorded execution status: Not recorded'); expect(text).toContain('2026-11-20T18:00:00+05:30');
  expect(text).toContain('  Recorded reason\n  second line'); expect(text).not.toContain('private-plan-actor');
  expect(text).not.toContain('77'); expect(text).toContain('Other plan pages and approval-request history are not included.');
  expect(text).not.toContain('RESPONSE PLAN EVIDENCE OMITTED BY REVIEWER');
});
it('does not infer the absence of response work from an empty visible plan page', () => {
  const text = caseHandoff({ ...snapshot, responsePlans: { plans: [], page: 1, size: 10, total: 0, fetchedAt: 'now' } }, false);
  expect(text).toContain('This does not establish that no response plan exists elsewhere.');
});
