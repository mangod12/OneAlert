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
