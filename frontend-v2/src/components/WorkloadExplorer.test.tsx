import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkloadExplorer, type WorkloadRecord } from './WorkloadExplorer';
afterEach(cleanup);
const base = { alerts_open: 0, cases_open: 0, tasks_open: 0, alerts_overdue: 0, cases_overdue: 0, tasks_overdue: 0 };
const members: WorkloadRecord[] = [
  { ...base, user_id: 1, full_name: 'Ada', email: 'ada@example.test', alerts_open: 3, alerts_overdue: 1, tasks_open: 2, tasks_overdue: 1 },
  { ...base, user_id: 2, full_name: null, email: 'zed@example.test' },
  { ...base, user_id: 3, full_name: 'Ben', email: 'ben@example.test', cases_open: 7, cases_overdue: 4 },
];
function show() { return render(<WorkloadExplorer members={members} generatedAt="2026-11-20T00:00:00Z">{member => <li key={member.user_id} data-testid="member">{member.full_name || member.email}</li>}</WorkloadExplorer>); }
const names = () => screen.queryAllByTestId('member').map(item => item.textContent);
describe('team workload explorer', () => {
  it('shows totals for the visible records and does not infer staffing capacity', () => {
    show();
    expect(screen.getByRole('status')).toHaveTextContent('3 of 3 members shown. Matching members: 12 open assigned records, 6 overdue.');
    expect(screen.getByText(/not staffing capacity or performance/)).toBeInTheDocument();
    expect(names()).toEqual(['Ada', 'zed@example.test', 'Ben']);
  });
  it('filters names and emails case-insensitively with matching totals', () => {
    show();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find team member' }), { target: { value: ' ADA@ ' } });
    expect(names()).toEqual(['Ada']);
    expect(screen.getByRole('status')).toHaveTextContent('5 open assigned records, 2 overdue');
  });
  it('separates overdue, open and no-open scopes and clears them', () => {
    show();
    const scope = screen.getByRole('combobox', { name: 'Workload scope' });
    fireEvent.change(scope, { target: { value: 'overdue' } });
    expect(names()).toEqual(['Ada', 'Ben']);
    fireEvent.change(scope, { target: { value: 'none' } });
    expect(names()).toEqual(['zed@example.test']);
    expect(screen.getByRole('status')).toHaveTextContent('0 open assigned records, 0 overdue');
    fireEvent.click(screen.getByRole('button', { name: 'Clear workload filters' }));
    expect(names()).toHaveLength(3);
  });
  it('orders by recorded, overdue, open counts or name', () => {
    show();
    const order = screen.getByRole('combobox', { name: 'Workload order' });
    for (const value of ['overdue', 'open']) {
      fireEvent.change(order, { target: { value } });
      expect(names()).toEqual(['Ben', 'Ada', 'zed@example.test']);
    }
    fireEvent.change(order, { target: { value: 'name' } });
    expect(names()).toEqual(['Ada', 'Ben', 'zed@example.test']);
    fireEvent.change(order, { target: { value: 'recorded' } });
    expect(names()).toEqual(['Ada', 'zed@example.test', 'Ben']);
  });
  it('makes no matching members distinct from no assigned work', () => {
    show();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'not a member' } });
    expect(screen.getByText(/No team members match/)).toBeInTheDocument();
    expect(names()).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('0 of 3 members shown');
  });
});
