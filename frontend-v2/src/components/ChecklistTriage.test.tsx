import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChecklistTriage } from './ChecklistTriage';
afterEach(cleanup);
const tasks = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, title: `Task ${i + 1}`, done: i === 0, position: i, assignee_id: i % 2 ? 5 : null, due_date: i === 1 ? '2026-11-20' : null }));
const props = { tasks, today: '2026-11-21', currentUserId: 5, members: [{ id: 5, full_name: 'Reviewer', email: 'reviewer@example.com' }] };
const row = (task: typeof tasks[0]) => <li key={task.id} id={`case-task-${task.id}`} tabIndex={-1}>{task.title}</li>;
it('pages tasks independently while keeping whole-checklist counts', () => {
  render(<ChecklistTriage {...props}>{row}</ChecklistTriage>);
  expect(screen.getByText(/23 total tasks · 22 open · 1 overdue/)).toBeTruthy();
  expect(screen.queryByText('Task 21')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Next task page' }));
  expect(screen.getByText('Task 23')).toBeTruthy(); expect(screen.queryByText('Task 1')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter checklist task status'), { target: { value: 'done' } });
  expect(screen.getByText('Task 1')).toBeTruthy(); expect(screen.getByText(/Page 1 of 1/)).toBeTruthy();
});
it('combines filters, shows a distinct no-match result and clears the view', () => {
  render(<ChecklistTriage {...props}>{row}</ChecklistTriage>);
  fireEvent.change(screen.getByLabelText('Filter checklist assignee'), { target: { value: 'mine' } });
  fireEvent.change(screen.getByLabelText('Filter checklist due date'), { target: { value: 'overdue' } });
  expect(screen.getByText('Task 2')).toBeTruthy(); expect(screen.queryByText('Task 4')).toBeNull();
  fireEvent.change(screen.getByLabelText('Search investigation task titles'), { target: { value: 'not-there' } });
  expect(screen.getByRole('status').textContent).toContain('No tasks match');
  fireEvent.click(screen.getByRole('button', { name: 'Clear task filters' })); expect(screen.getByText('Task 1')).toBeTruthy();
});
it('recovers the last page when the final matching task disappears', () => {
  const view = render(<ChecklistTriage {...props}>{row}</ChecklistTriage>);
  fireEvent.click(screen.getByRole('button', { name: 'Next task page' }));
  view.rerender(<ChecklistTriage {...props} tasks={tasks.slice(0, 20)}>{row}</ChecklistTriage>);
  expect(screen.getByText(/Page 1 of 1/)).toBeTruthy(); expect(screen.getByText('Task 20')).toBeTruthy();
});

it('opens the page containing an exact linked task, focuses it and can reveal it after filtering', () => {
  render(<ChecklistTriage {...props} linkedTaskId={23}>{row}</ChecklistTriage>);
  expect(screen.getByText('Task 23')).toBeTruthy(); expect(screen.queryByText('Task 1')).toBeNull();
  expect(document.activeElement?.id).toBe('case-task-23');
  fireEvent.change(screen.getByLabelText('Search investigation task titles'), { target: { value: 'Task 2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show linked task #23' }));
  expect(document.activeElement?.id).toBe('case-task-23'); expect(screen.getByText(/Page 2 of 2/)).toBeTruthy();
});
it('does not infer an exact task match from a missing record', () => {
  render(<ChecklistTriage {...props} linkedTaskId={99}>{row}</ChecklistTriage>);
  expect(screen.getByRole('alert').textContent).toContain('not in this loaded investigation checklist');
  expect(screen.queryByRole('button', { name: 'Show linked task #99' })).toBeNull();
});

it('summarizes whole loaded workload and drills into exact open assignee scope from any page or filters', () => {
  render(<ChecklistTriage {...props}>{row}</ChecklistTriage>);
  expect(screen.getByRole('list', { name: 'Assignee checklist workload' }).textContent).toContain('Reviewer (#5)');
  expect(screen.getByRole('list', { name: 'Assignee checklist workload' }).textContent).toContain('11 open · 0 completed · 11 total');
  fireEvent.click(screen.getByRole('button', { name: 'Next task page' }));
  fireEvent.change(screen.getByLabelText('Search investigation task titles'), { target: { value: 'nothing' } });
  fireEvent.click(screen.getByText('Show open tasks: Reviewer (#5)'));
  expect((screen.getByLabelText('Filter checklist task status') as HTMLInputElement).value).toBe('open');
  expect((screen.getByLabelText('Filter checklist assignee') as HTMLInputElement).value).toBe('5');
  expect((screen.getByLabelText('Search investigation task titles') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Filter checklist due date') as HTMLInputElement).value).toBe('all');
  expect((screen.getByLabelText('Sort investigation tasks') as HTMLInputElement).value).toBe('due');
  expect(screen.getByText('Task 2')).toBeTruthy(); expect(screen.queryByText('Task 1')).toBeNull();
  expect(screen.getByText(/Page 1 of 1/)).toBeTruthy();
});
it('drills into unassigned open tasks without conflating completed tasks or missing members', () => {
  render(<ChecklistTriage {...props} tasks={[...tasks, { ...tasks[0], id: 99, assignee_id: 99 }]}>{row}</ChecklistTriage>);
  expect((screen.getByText('Show open tasks: Member (#99)') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Show open tasks: Unassigned'));
  expect((screen.getByLabelText('Filter checklist assignee') as HTMLInputElement).value).toBe('unassigned');
  expect(screen.queryByText('Task 1')).toBeNull(); expect(screen.getByText('Task 3')).toBeTruthy();
});
it('labels date buckets unknown when local date is not usable', () => {
  render(<ChecklistTriage {...props} today="">{row}</ChecklistTriage>);
  expect(screen.getByText(/local date is unavailable/)).toBeTruthy();
  expect(screen.getAllByText(/Date-based counts unknown/)).toHaveLength(2);
});
it('exports all matching pages, never just the visible page, and holds the reviewed snapshot', () => {
  const view = render(<ChecklistTriage {...props} caseId={12}>{row}</ChecklistTriage>);
  fireEvent.click(screen.getByRole('button', { name: 'Next task page' }));
  fireEvent.click(screen.getByText('Review matching checklist CSV (23 tasks)'));
  expect(screen.getByRole('dialog').textContent).toContain('23 matching tasks of 23 loaded tasks');
  expect(screen.getByRole('list', { name: 'Checklist export task review' }).children).toHaveLength(23);
  view.rerender(<ChecklistTriage {...props} caseId={12} tasks={tasks.slice(0, 2)}>{row}</ChecklistTriage>);
  expect(screen.getByRole('dialog').textContent).toContain('23 matching tasks of 23 loaded tasks');
  fireEvent.click(screen.getByText('Cancel checklist export'));
  fireEvent.change(screen.getByLabelText('Filter checklist task status'), { target: { value: 'done' } });
  fireEvent.click(screen.getByText('Review matching checklist CSV (1 tasks)'));
  expect(screen.getByRole('list', { name: 'Checklist export task review' }).textContent).toContain('#1: Task 1');
});
it('disables export for no matching tasks or while checklist work is busy', () => {
  const view = render(<ChecklistTriage {...props} caseId={12} selectionBusy>{row}</ChecklistTriage>);
  expect((screen.getByText('Review matching checklist CSV (23 tasks)') as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ChecklistTriage {...props} caseId={12}>{row}</ChecklistTriage>);
  fireEvent.change(screen.getByLabelText('Search investigation task titles'), { target: { value: 'none' } });
  expect((screen.getByText('Review matching checklist CSV (0 tasks)') as HTMLButtonElement).disabled).toBe(true);
});
it('restores exact incoming filters without replacing an unknown assignee with anyone', () => {
  render(<ChecklistTriage {...props} caseId={12} initialSearch="checklist=1&checklist_assignee=99&checklist_status=open">{row}</ChecklistTriage>);
  expect(screen.getByText(/No tasks match/)).toBeTruthy(); expect((screen.getByText('Review matching checklist CSV (0 tasks)') as HTMLButtonElement).disabled).toBe(true);
});
it('fails closed on ambiguous incoming filter handoffs and recovers only through an explicit filter choice', () => {
  render(<ChecklistTriage {...props} caseId={12} onSelectMatching={() => {}} initialSearch="checklist=1&checklist_assignee=mine">{row}</ChecklistTriage>);
  expect(screen.getByRole('alert').textContent).toContain('invalid or ambiguous'); expect(screen.queryByText('Task 1')).toBeNull();
  expect((screen.getByText('Select matching checklist tasks (up to 100)') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Copy current checklist filter link') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Clear task filters')); expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByText('Task 1')).toBeTruthy();
});
