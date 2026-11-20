import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ChecklistBatchTools } from './ChecklistBatchTools';
import type { BatchTask } from '../utils/checklistBatch';
vi.mock('../api/client', () => ({ default: { patch: vi.fn() } }));
const patch = vi.mocked(apiClient.patch), saved = vi.fn(), busy = vi.fn();
const tasks: BatchTask[] = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, title: `Task ${index + 1}`, position: index, done: false, assignee_id: null, due_date: null, completed_at: null }));
const props = { caseId: 7, tasks, members: [{ id: 5, full_name: 'Reviewer', email: 'reviewer@example.com' }], externalBusy: false, onSaved: saved, onBusyChange: busy };
const rows = ({ selected, toggle, select }: { selected: Set<number>; toggle: (id: number) => void; select: (ids: number[]) => void }) => <><button onClick={() => select(tasks.map(task => task.id))}>Select loaded matches</button>{tasks.map(task => <input key={task.id} type="checkbox" aria-label={`Pick ${task.id}`} checked={selected.has(task.id)} onChange={() => toggle(task.id)} />)}</>;
function show(overrides = {}) { return render(<ChecklistBatchTools {...props} {...overrides}>{rows}</ChecklistBatchTools>); }
function selectOne() { fireEvent.click(screen.getByLabelText('Pick 1')); }
function review() { fireEvent.click(screen.getByRole('button', { name: 'Review selected checklist change' })); }
beforeEach(() => { vi.resetAllMocks(); patch.mockImplementation(async (url, change) => ({ data: { ...tasks[Number(url.split('/').at(-1)) - 1], case_id: 7, ...(change as object) } })); });
afterEach(cleanup);
it('reviews the complete selected list before any write, then saves only the chosen field', async () => {
  show(); selectOne(); review(); expect(patch).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain('exactly 1 selected tasks: #1');
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' }));
  await screen.findByText(/Confirmed changes for 1 of 1/);
  expect(patch).toHaveBeenCalledExactlyOnceWith('/cases/7/tasks/1', { done: true });
  expect(saved).toHaveBeenCalledWith([expect.objectContaining({ id: 1, done: true })]);
  expect((screen.getByLabelText('Pick 1') as HTMLInputElement).checked).toBe(false);
  expect(busy.mock.calls.map(call => call[0])).toEqual([true, false]);
});
it.each([['reopen', { done: false }], ['clear_date', { due_date: null }], ['unassign', { assignee_id: null }]])('saves only the reviewed %s operation', async (action, payload) => {
  show(); selectOne(); fireEvent.change(screen.getByLabelText('Selected checklist action'), { target: { value: action } }); review();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByText(/Confirmed changes for 1 of 1/);
  expect(patch).toHaveBeenCalledExactlyOnceWith('/cases/7/tasks/1', payload);
});
it('requires a date or resolved member before date/assignment review', async () => {
  show(); selectOne(); fireEvent.change(screen.getByLabelText('Selected checklist action'), { target: { value: 'date' } });
  expect((screen.getByRole('button', { name: 'Review selected checklist change' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Selected checklist due date'), { target: { value: '2026-11-25' } }); review();
  expect(screen.getByRole('dialog').textContent).toContain('2026-11-25'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.change(screen.getByLabelText('Selected checklist action'), { target: { value: 'assign' } });
  expect((screen.getByRole('button', { name: 'Review selected checklist change' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Selected checklist assignee'), { target: { value: '5' } }); review();
  expect(screen.getByRole('dialog').textContent).toContain('Assign to Reviewer');
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByText(/Confirmed changes for 1 of 1/);
  expect(patch).toHaveBeenCalledExactlyOnceWith('/cases/7/tasks/1', { assignee_id: 5 });
});
it('keeps failed and wrong-record tasks selected, without optimistic success or automatic retry', async () => {
  patch.mockImplementation(async (url, change) => {
    const id = Number(url.split('/').at(-1)); if (id === 2) throw new Error('Unavailable');
    return { data: { ...tasks[id - 1], case_id: id === 3 ? 99 : 7, ...(change as object) } };
  });
  show(); fireEvent.click(screen.getByRole('button', { name: 'Select loaded matches' })); review();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 4 reviewed tasks' }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toContain('2 of 4');
  expect((screen.getByLabelText('Pick 2') as HTMLInputElement).checked).toBe(true); expect((screen.getByLabelText('Pick 3') as HTMLInputElement).checked).toBe(true);
  expect(saved).toHaveBeenCalledWith([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 4 })]); expect(patch).toHaveBeenCalledTimes(4);
});
it('limits saves to three in flight and ignores duplicate confirmation while busy', async () => {
  const finish: (() => void)[] = []; patch.mockImplementation((url, change) => new Promise(resolve => finish.push(() => resolve({ data: { ...tasks[Number(url.split('/').at(-1)) - 1], case_id: 7, ...(change as object) } }))));
  show(); fireEvent.click(screen.getByRole('button', { name: 'Select loaded matches' })); review();
  const confirm = screen.getByRole('button', { name: 'Apply to 4 reviewed tasks' }); fireEvent.click(confirm); fireEvent.click(confirm);
  expect(patch).toHaveBeenCalledTimes(3); expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish.splice(0).forEach(resolve => resolve())); await waitFor(() => expect(patch).toHaveBeenCalledTimes(4));
  await act(async () => finish.splice(0).forEach(resolve => resolve())); await screen.findByText(/Confirmed changes for 4 of 4/);
});
it('invalidates a review when loaded records change and blocks writes during another task save', () => {
  const view = show(); selectOne(); review(); view.rerender(<ChecklistBatchTools {...props} tasks={[...tasks]}>{rows}</ChecklistBatchTools>);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<ChecklistBatchTools {...props} externalBusy>{rows}</ChecklistBatchTools>);
  expect((screen.getByRole('button', { name: 'Review selected checklist change' }) as HTMLButtonElement).disabled).toBe(true); expect(patch).not.toHaveBeenCalled();
});
it('caps accumulated selection at 100 exact loaded task identities', () => {
  const many = Array.from({ length: 105 }, (_, index) => ({ ...tasks[0], id: index + 1 }));
  render(<ChecklistBatchTools {...props} tasks={many}>{selection => <button onClick={() => selection.select(many.map(task => task.id))}>Select all records</button>}</ChecklistBatchTools>);
  fireEvent.click(screen.getByRole('button', { name: 'Select all records' })); expect(screen.getByText('100 selected loaded tasks')).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Selected checklist task review' }).children.length).toBe(100);
});
it('does not start further batches or update task records after leaving the workspace', async () => {
  const finish: (() => void)[] = []; patch.mockImplementation((url, change) => new Promise(resolve => finish.push(() => resolve({ data: { ...tasks[Number(url.split('/').at(-1)) - 1], case_id: 7, ...(change as object) } }))));
  const view = show(); fireEvent.click(screen.getByRole('button', { name: 'Select loaded matches' })); review();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 4 reviewed tasks' })); expect(patch).toHaveBeenCalledTimes(3);
  view.unmount(); await act(async () => finish.splice(0).forEach(resolve => resolve()));
  expect(patch).toHaveBeenCalledTimes(3); expect(saved).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false);
});
it('offers an explicit reload after unconfirmed saves rather than losing failed selection', async () => {
  patch.mockRejectedValueOnce(new Error('Unavailable')); const reload = vi.fn(); show({ onRefresh: reload }); selectOne(); review();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByRole('alert');
  expect((screen.getByLabelText('Pick 1') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload investigation to verify results (clears selection)' })); expect(reload).toHaveBeenCalledTimes(1);
});
