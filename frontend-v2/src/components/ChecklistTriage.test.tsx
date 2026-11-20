import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChecklistTriage } from './ChecklistTriage';
afterEach(cleanup);
const tasks = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, title: `Task ${i + 1}`, done: i === 0, position: i, assignee_id: i % 2 ? 5 : null, due_date: i === 1 ? '2026-11-20' : null }));
const props = { tasks, today: '2026-11-21', currentUserId: 5, members: [{ id: 5, full_name: 'Reviewer', email: 'reviewer@example.com' }] };
const row = (task: typeof tasks[0]) => <li key={task.id}>{task.title}</li>;
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
