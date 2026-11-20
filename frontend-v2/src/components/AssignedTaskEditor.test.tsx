import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssignedTaskEditor, type EditableAssignedTask } from './AssignedTaskEditor';
vi.mock('../api/client', () => ({ default: { patch: vi.fn() } }));
const patch = vi.mocked(apiClient.patch), close = vi.fn(), changed = vi.fn();
const task = { task_id: 209, case_id: 7, title: 'Collect late-page evidence', done: false, due_date: '2026-11-23', case_title: 'Gateway investigation', case_status: 'open' };
const saved = { id: 209, case_id: 7, title: task.title, done: true, due_date: task.due_date, completed_at: '2026-11-21T00:00:00Z' };
beforeEach(() => { vi.resetAllMocks(); patch.mockResolvedValue({ data: saved }); });
afterEach(cleanup);
function show(value: EditableAssignedTask = task) { return render(<AssignedTaskEditor task={value} onClose={close} onChanged={changed} />); }
function review() { fireEvent.click(screen.getByRole('button', { name: 'Review task change' })); }
function confirm() { fireEvent.click(screen.getByRole('button', { name: 'Confirm task change' })); }
it('requires a separate exact-task review and sends one guarded assigned-task request', async () => {
  show(); expect(patch).not.toHaveBeenCalled(); review(); expect(patch).not.toHaveBeenCalled();
  expect(screen.getByText(/Complete only task #209/)).toBeTruthy(); confirm();
  await waitFor(() => expect(changed).toHaveBeenCalledWith(true));
  expect(patch).toHaveBeenCalledExactlyOnceWith('/cases/assigned-task-explorer/209', { case_id: 7, expected_title: task.title, expected_done: false, expected_due_date: '2026-11-23', expected_case_title: task.case_title, expected_case_status: 'open', action: 'complete', due_date: null });
});
it('reviews reopening completed work on inactive investigations without claiming to reopen its investigation', async () => {
  patch.mockResolvedValueOnce({ data: { ...saved, done: false, completed_at: null } }); show({ ...task, done: true, case_status: 'closed' });
  expect(screen.getByText(/This investigation is inactive/)).toBeTruthy(); review(); expect(screen.getByText(/completion timestamp will be cleared/)).toBeTruthy(); confirm();
  await waitFor(() => expect(changed).toHaveBeenCalledWith(true)); expect(patch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expected_done: true, action: 'reopen', expected_case_status: 'closed' }));
});
it('reviews only the date change and verifies that completion is preserved', async () => {
  patch.mockResolvedValueOnce({ data: { ...saved, done: false, completed_at: null, due_date: '2027-01-05' } }); show();
  fireEvent.change(screen.getByLabelText('Assigned task action'), { target: { value: 'set_due' } }); expect(screen.getByRole('button', { name: 'Review task change' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('New assigned task due date'), { target: { value: '2027-01-05' } }); review(); expect(screen.getByText(/from 2026-11-23 to 2027-01-05/)).toBeTruthy(); confirm();
  await waitFor(() => expect(changed).toHaveBeenCalledWith(true)); expect(patch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'set_due', due_date: '2027-01-05' }));
});
it('clears the task date only after review and disables a no-op clearing', async () => {
  patch.mockResolvedValueOnce({ data: { ...saved, done: false, due_date: null } }); show();
  fireEvent.change(screen.getByLabelText('Assigned task action'), { target: { value: 'clear_due' } }); review(); expect(screen.getByText(/to not set/)).toBeTruthy(); confirm();
  await waitFor(() => expect(changed).toHaveBeenCalledWith(true)); cleanup(); show({ ...task, due_date: null }); fireEvent.change(screen.getByLabelText('Assigned task action'), { target: { value: 'clear_due' } }); expect(screen.getByRole('button', { name: 'Review task change' })).toHaveProperty('disabled', true);
});
it.each([null, {}, { ...saved, id: 210 }, { ...saved, case_id: 8 }, { ...saved, title: 'Different task' }, { ...saved, done: 'true' }, { ...saved, due_date: null }, { ...saved, completed_at: null }, { ...saved, completed_at: 'not-a-time' }])('blocks retry after a malformed or mismatched save acknowledgement', async value => {
  patch.mockResolvedValueOnce({ data: value }); show(); review(); confirm(); await screen.findByRole('alert');
  expect(changed).toHaveBeenCalledWith(false); expect(changed).not.toHaveBeenCalledWith(true); expect(screen.queryByRole('button', { name: 'Confirm task change' })).toBeNull(); expect(patch).toHaveBeenCalledTimes(1);
});
it('keeps a conflict visible and never retries without a new server snapshot', async () => {
  patch.mockRejectedValueOnce({ isAxiosError: true, response: { data: { detail: 'The assigned task changed' } } }); show(); review(); confirm(); await screen.findByRole('alert'); expect(screen.getByText(/The assigned task changed/)).toBeTruthy(); expect(changed).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: 'Close and refresh workload' })); expect(close).toHaveBeenCalledTimes(1); expect(patch).toHaveBeenCalledTimes(1);
});
it('blocks duplicate submits, cancellation and Escape during a pending save', async () => {
  let finish!: (value: unknown) => void; patch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); show(); review(); confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Saving task change...' })); expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).not.toHaveBeenCalled();
  await act(async () => finish({ data: saved })); expect(patch).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith(true);
});
it('ignores a save reply after the task editor is unmounted', async () => {
  let finish!: (value: unknown) => void; patch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); review(); confirm(); view.unmount();
  await act(async () => finish({ data: saved })); expect(changed).not.toHaveBeenCalled();
});
