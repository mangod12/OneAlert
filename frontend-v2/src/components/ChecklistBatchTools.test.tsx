import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ChecklistBatchTools } from './ChecklistBatchTools';
import type { BatchTask } from '../utils/checklistBatch';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), patch = vi.mocked(apiClient.patch), saved = vi.fn(), busy = vi.fn();
const tasks: BatchTask[] = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, title: `Task ${index + 1}`, position: index, done: false, assignee_id: null, due_date: null, completed_at: null }));
const account = { id: 5, email: 'reviewer@example.com', role: 'analyst', org_id: 7, is_active: true };
const props = { caseId: 7, tasks, members: [{ id: 6, full_name: 'Recipient', email: 'recipient@example.com' }], externalBusy: false, onSaved: saved, onBusyChange: busy };
const rows = ({ selected, toggle, select }: { selected: Set<number>; toggle: (id: number) => void; select: (ids: number[]) => void }) => <><button onClick={() => select(tasks.map(task => task.id))}>Select loaded matches</button>{tasks.map(task => <input key={task.id} type="checkbox" aria-label={`Pick ${task.id}`} checked={selected.has(task.id)} onChange={() => toggle(task.id)} />)}</>;
function show(overrides = {}) { return render(<ChecklistBatchTools {...props} {...overrides}>{rows}</ChecklistBatchTools>); }
function selectOne() { fireEvent.click(screen.getByLabelText('Pick 1')); }
async function review() { fireEvent.click(screen.getByRole('button', { name: 'Review selected checklist change' })); return screen.findByRole('dialog'); }
const taskId = (url: string) => Number(url.split('/')[4]);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: account }); post.mockImplementation(async (url, change) => ({ data: { case_id: 7, owner_id: 5, assigned_to_id: null, title: 'Exact investigation', status: 'open', severity: 'high', task: tasks[taskId(url) - 1], proposed_done: (change as { done?: boolean }).done, proposed_due_date: (change as { due_date?: string }).due_date, proposed_assignee_id: (change as { assignee_id?: number }).assignee_id, proposed_assignee: (change as { assignee_id?: number }).assignee_id ? { id: 6, email: 'recipient@example.com', org_id: 7, is_active: true } : null, grants_investigation_access: Boolean((change as { assignee_id?: number }).assignee_id), assignment_notification: Boolean((change as { assignee_id?: number }).assignee_id), retained_access_reasons: [], target_existing_access_reasons: [], reviewed_fingerprint: 'a'.repeat(64) } })); patch.mockImplementation(async (url, change) => ({ status: 200, data: { ...tasks[taskId(url) - 1], case_id: 7, ...(change as object) } })); });
afterEach(cleanup);
it('fetches exact saved evidence, reviews all selected tasks, then uses conditional saves', async () => {
  show(); selectOne(); await review(); expect(patch).not.toHaveBeenCalled(); expect(screen.getByRole('dialog').textContent).toContain('exactly 1 selected tasks'); expect(post).toHaveBeenCalledWith('/cases/7/tasks/1/completion-review', { done: true });
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByText(/Confirmed changes for 1 of 1/);
  expect(patch).toHaveBeenCalledExactlyOnceWith('/cases/7/tasks/1/completion-reviewed', { done: true }, { params: { reviewed_fingerprint: 'a'.repeat(64) } }); expect(saved).toHaveBeenCalledWith([expect.objectContaining({ id: 1, done: true })]); expect(get).toHaveBeenCalledTimes(2);
});
it('discloses exact assignment recipient, access and notifications before saving', async () => {
  show(); selectOne(); fireEvent.change(screen.getByLabelText('Selected checklist action'), { target: { value: 'assign' } }); fireEvent.change(screen.getByLabelText('Selected checklist assignee'), { target: { value: '6' } }); await review(); expect(screen.getByRole('dialog').textContent).toContain('recipient@example.com'); expect(screen.getByRole('dialog').textContent).toContain('New investigation access: yes'); expect(screen.getByRole('dialog').textContent).toContain('Assignment notification: yes'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(patch).not.toHaveBeenCalled();
});
it('fails closed before saves when any saved task changed', async () => {
  post.mockResolvedValue({ data: {} }); show(); selectOne(); fireEvent.click(screen.getByRole('button', { name: 'Review selected checklist change' })); await screen.findByText(/complete selected task review could not be verified/); expect(patch).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Review selected checklist change' })).toHaveProperty('disabled', true);
});
it('stops sequential saves at the first uncertain result, leaving later tasks unattempted', async () => {
  patch.mockImplementation(async (url, change) => { if (taskId(url) === 2) throw Error('PRIVATE'); return { status: 200, data: { ...tasks[taskId(url) - 1], case_id: 7, ...(change as object) } }; });
  show(); fireEvent.click(screen.getByRole('button', { name: 'Select loaded matches' })); await review(); fireEvent.click(screen.getByRole('button', { name: 'Apply to 4 reviewed tasks' })); await screen.findByRole('alert'); expect(patch).toHaveBeenCalledTimes(2); expect(saved).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]); expect(document.body.textContent).not.toContain('PRIVATE'); expect(screen.getByLabelText('Pick 3')).toHaveProperty('checked', true);
});
it('requires the same acting account before sending any saves', async () => {
  show(); selectOne(); await review(); get.mockResolvedValue({ data: { ...account, role: 'admin' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByRole('alert'); expect(patch).not.toHaveBeenCalled();
});
it.each([202, 204])('does not count unconfirmed status%s as success', async status => {
  patch.mockResolvedValue({ status, data: { ...tasks[0], case_id: 7, done: true } }); show(); selectOne(); await review(); fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByRole('alert'); expect(saved).toHaveBeenCalledWith([]); expect(patch).toHaveBeenCalledOnce();
});
it('uses only one save in flight and stops after unmount', async () => {
  let finish: (() => void) | undefined; patch.mockImplementation((url, change) => new Promise(resolve => { finish = () => resolve({ status: 200, data: { ...tasks[taskId(url) - 1], case_id: 7, ...(change as object) } }); }));
  const view = show(); fireEvent.click(screen.getByRole('button', { name: 'Select loaded matches' })); await review(); fireEvent.click(screen.getByRole('button', { name: 'Apply to 4 reviewed tasks' })); await waitFor(() => expect(patch).toHaveBeenCalledOnce()); view.unmount(); await act(async () => finish?.()); expect(patch).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
});
it('excludes no-op tasks without writes', async () => { show(); selectOne(); fireEvent.change(screen.getByLabelText('Selected checklist action'), { target: { value: 'reopen' } }); fireEvent.click(screen.getByRole('button', { name: 'Review selected checklist change' })); await screen.findByText(/Every selected task already has this value/); expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled(); });
it('invalidates prepared review on changed loaded tasks', async () => { const view = show(); selectOne(); await review(); view.rerender(<ChecklistBatchTools {...props} tasks={[...tasks]}>{rows}</ChecklistBatchTools>); expect(screen.queryByRole('dialog')).toBeNull(); expect(patch).not.toHaveBeenCalled(); });
it('read-only mode never gains selection or write authority', () => { show({ readOnly: true }); fireEvent.click(screen.getByRole('button', { name: 'Select loaded matches' })); expect(screen.getByLabelText('Pick 1')).toHaveProperty('checked', false); expect(post).not.toHaveBeenCalled(); });
it('offers reload after uncertainty rather than a retry', async () => { patch.mockRejectedValue(Error('Unknown')); const reload = vi.fn(); show({ onRefresh: reload }); selectOne(); await review(); fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Reload investigation to verify results (clears selection)' })); expect(reload).toHaveBeenCalledOnce(); expect(patch).toHaveBeenCalledOnce(); });

it('keeps exact partial outcomes visible after reload clears selection', async () => {
  patch.mockImplementation(async (url, change) => { if (taskId(url) === 2) throw Error('Unknown'); return { status: 200, data: { ...tasks[taskId(url) - 1], case_id: 7, ...(change as object) } }; });
  const reload = vi.fn(); show({ onRefresh: reload }); fireEvent.click(screen.getByRole('button', { name: 'Select loaded matches' })); await review(); fireEvent.click(screen.getByRole('button', { name: 'Apply to 4 reviewed tasks' })); await screen.findByRole('alert');
  const receipt = screen.getByRole('region', { name: 'Reviewed checklist save receipt' }); expect(receipt.textContent).toContain('#1: Task 1 · Confirmed'); expect(receipt.textContent).toContain('#2: Task 2 · Unconfirmed, may have applied'); expect(receipt.textContent).toContain('#3: Task 3 · Not attempted');
  fireEvent.click(screen.getByRole('button', { name: 'Reload investigation to verify results (clears selection)' })); expect(reload).toHaveBeenCalledOnce(); expect(screen.getByRole('region', { name: 'Reviewed checklist save receipt' })).toBeTruthy(); expect(screen.getByLabelText('Pick 2')).toHaveProperty('checked', false);
});
it('records account preflight failure as not attempted, never as unconfirmed', async () => {
  show(); selectOne(); await review(); get.mockRejectedValue(Error('Unavailable')); fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' })); await screen.findByRole('alert'); expect(screen.getByRole('list', { name: 'Task save outcomes' }).textContent).toContain('Not attempted'); expect(screen.getByRole('list', { name: 'Task save outcomes' }).textContent).not.toContain('Unconfirmed, may have applied'); expect(patch).not.toHaveBeenCalled();
});
