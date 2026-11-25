import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssignedTaskHandoff } from './AssignedTaskHandoff';
const task = { task_id: 209, case_id: 7, title: '<b>Private task</b>', case_title: 'Private investigation', done: false, due_date: '2026-11-25', completed_at: null };
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });
function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); return writeText; }
function open() { fireEvent.click(screen.getByRole('button', { name: 'Review assigned task #209 link' })); }
it('reviews literal loaded metadata without copying, requesting or changing records', () => {
  const write = clipboard(); render(<AssignedTaskHandoff task={task} />); open(); const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Task #209: <b>Private task</b>'); expect(dialog.querySelector('b')).toBeNull(); expect(dialog).toHaveTextContent('Open · Task due: 2026-11-25 · Recorded completion: Not recorded');
  expect(dialog).toHaveTextContent('not a fresh server read'); expect(dialog).toHaveTextContent('viewer\'s own access'); expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close assigned task link review' })); expect(screen.queryByRole('dialog')).toBeNull();
});
it('copies exact ID-only case/task destination without current workload query, hash, titles or dates', async () => {
  const write = clipboard(); window.history.replaceState({}, '', '/app/my-tasks?query=private&token=secret#filters'); render(<AssignedTaskHandoff task={task} />); open();
  fireEvent.click(screen.getByRole('button', { name: 'Copy ID-only assigned task link' })); await screen.findByText(/ID-only assigned task link copied/);
  expect(write).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/app/cases/7?task=209`);
});
it('freezes reviewed values and IDs through changed props and refreshes them only on new review', async () => {
  const write = clipboard(); const view = render(<AssignedTaskHandoff task={task} />); open();
  view.rerender(<AssignedTaskHandoff task={{ ...task, case_id: 8, title: 'New task', done: true, completed_at: '2026-11-25T00:00:00Z', due_date: null }} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('Private task'); fireEvent.click(screen.getByRole('button', { name: 'Copy ID-only assigned task link' })); await screen.findByText(/link copied/); expect(write).toHaveBeenCalledWith(`${window.location.origin}/app/cases/7?task=209`);
  fireEvent.click(screen.getByRole('button', { name: 'Close assigned task link review' })); open(); expect(screen.getByRole('dialog')).toHaveTextContent('Investigation #8'); expect(screen.getByRole('dialog')).toHaveTextContent('Completed · Task due: Not set · Recorded completion: 2026-11-25T00:00:00Z');
});
it('reports copy failure honestly and permits explicit retry', async () => {
  const write = clipboard(vi.fn().mockRejectedValueOnce(Error('denied')).mockResolvedValueOnce(undefined)); render(<AssignedTaskHandoff task={task} />); open();
  fireEvent.click(screen.getByRole('button', { name: 'Copy ID-only assigned task link' })); await screen.findByText(/Copy unavailable/); expect(screen.queryByText(/link copied/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy ID-only assigned task link' })); await screen.findByText(/link copied/); expect(write).toHaveBeenCalledTimes(2);
});
it('blocks pending double-copy, ignores late completion and supports Escape with focus return', async () => {
  let finish!: () => void; const write = clipboard(vi.fn(() => new Promise<void>(resolve => { finish = resolve; }))); render(<AssignedTaskHandoff task={task} />); const trigger=screen.getByRole('button'); trigger.focus(); open();
  const button = screen.getByRole('button', { name: 'Copy ID-only assigned task link' }); expect(button).toHaveFocus(); fireEvent.click(button); fireEvent.click(button); expect(write).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(trigger).toHaveFocus(); await act(async () => finish()); expect(screen.queryByText(/link copied/)).toBeNull();
});
