import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChecklistTaskHandoff } from './ChecklistTaskHandoff';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const task = { id: 23, title: '<b>Private endpoint title</b>', done: false, position: 0, due_date: '2026-11-24', assignee_id: 99 };
function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); return writeText; }
it('reviews literal loaded details without automatic copy or markup interpretation', () => {
  const write = clipboard(); render(<ChecklistTaskHandoff caseId={7} task={task} />); fireEvent.click(screen.getByText('Review task #23 link'));
  const dialog = screen.getByRole('dialog'); expect(dialog.textContent).toContain('#23: <b>Private endpoint title</b>'); expect(dialog.querySelector('b')).toBeNull(); expect(dialog.textContent).toContain('Assignee #99'); expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Close task link review')); expect(screen.queryByRole('dialog')).toBeNull();
});
it('copies only exact case and task IDs, excluding titles, state, filters, notes and hash', async () => {
  const write = clipboard(); window.history.replaceState({}, '', '/app/cases/7?note=5&token=private#sensitive');
  render(<ChecklistTaskHandoff caseId={7} task={task} />); fireEvent.click(screen.getByText('Review task #23 link')); fireEvent.click(screen.getByText('Copy ID-only task link'));
  await screen.findByText(/ID-only task link copied/); expect(write).toHaveBeenCalledWith(`${window.location.origin}/app/cases/7?task=23`); expect(write).toHaveBeenCalledOnce();
});
it('holds reviewed identity and metadata if the row changes, then refreshes on a new review', () => {
  clipboard(); const view = render(<ChecklistTaskHandoff caseId={7} task={task} />); fireEvent.click(screen.getByText('Review task #23 link'));
  view.rerender(<ChecklistTaskHandoff caseId={7} task={{ ...task, title: 'New title', done: true }} />);
  expect(screen.getByRole('dialog').textContent).toContain('Private endpoint title'); expect(screen.getByRole('dialog').textContent).toContain('Loaded state: Open');
  fireEvent.click(screen.getByText('Close task link review')); fireEvent.click(screen.getByText('Review task #23 link')); expect(screen.getByRole('dialog').textContent).toContain('New title');
});
it('shows clipboard failure without a false success and allows an explicit retry', async () => {
  const write = clipboard(vi.fn().mockRejectedValueOnce(Error('denied')).mockResolvedValueOnce(undefined));
  render(<ChecklistTaskHandoff caseId={7} task={{ ...task, assignee_id: null, due_date: null, done: true }} />); fireEvent.click(screen.getByText('Review task #23 link')); fireEvent.click(screen.getByText('Copy ID-only task link'));
  await screen.findByText(/could not be copied/); expect(screen.getByRole('dialog').textContent).toContain('Completed · Due not set · Unassigned');
  fireEvent.click(screen.getByText('Copy ID-only task link')); await screen.findByText(/ID-only task link copied/); expect(write).toHaveBeenCalledTimes(2);
});
it('locks repeated copies while pending and ignores a result after closing', async () => {
  let finish!: () => void; const write = clipboard(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
  render(<ChecklistTaskHandoff caseId={7} task={task} />); fireEvent.click(screen.getByText('Review task #23 link')); fireEvent.click(screen.getByText('Copy ID-only task link')); fireEvent.click(screen.getByText('Copy ID-only task link')); expect(write).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Close task link review')); finish(); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
