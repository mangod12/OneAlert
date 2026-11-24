import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { AssignedWorkloadBreakdown } from './AssignedWorkloadBreakdown';
afterEach(cleanup);
const group = { case_id: 7, total: 209, open: 200, completed: 9, without_due_date: 2 };
function show(groups: unknown, groupCount: unknown = 1, total = 209) { render(<MemoryRouter><AssignedWorkloadBreakdown groups={groups} groupCount={groupCount} total={total} limit={50} /></MemoryRouter>); }
it('shows all matching per-investigation counts, not a task-page sample, with whole-checklist destination caveat', () => { show([group]); expect(screen.getByText(/209 matching tasks/)).toBeTruthy(); expect(screen.getByRole('link').getAttribute('href')).toBe('/cases/7'); expect(screen.getByText(/whole current checklist/)).toBeTruthy(); });
it.each([undefined, [null], [{ ...group, total: -1 }], [{ ...group, open: 1 }], [group, group], [{ ...group, without_due_date: 210 }], [{ ...group, case_id: 0 }]])('does not invent groups from invalid evidence %j', groups => { show(groups); expect(screen.getByText(/breakdown unavailable/)).toBeTruthy(); expect(screen.queryByRole('link')).toBeNull(); });
it('labels the top50 cap instead of claiming every investigation was shown', () => { show(Array.from({ length: 50 }, (_, i) => ({ ...group, case_id: i + 1, total: 1, open: 1, completed: 0, without_due_date: 0 })), 51, 51); expect(screen.getByText(/Showing 50 of 51/)).toBeTruthy(); expect(screen.getAllByRole('link')).toHaveLength(50); });
it('rejects incomplete and wrongly ordered groups or totals', () => { show([{ ...group, total: 1, open: 1, completed: 0, without_due_date: 0 }], 2); expect(screen.getByText(/breakdown unavailable/)).toBeTruthy(); });
it.each([
  { groups: [], count: 0, total: 1 },
  { groups: [{ ...group, case_id: 8 }, { ...group, case_id: 7 }], count: 2, total: 418 },
  { groups: [{ ...group, total: 1, open: 1, completed: 0, without_due_date: 0 }, group], count: 2, total: 210 },
])('rejects inconsistent totals and ordering %j', value => { show(value.groups, value.count, value.total); expect(screen.getByText(/breakdown unavailable/)).toBeTruthy(); });
