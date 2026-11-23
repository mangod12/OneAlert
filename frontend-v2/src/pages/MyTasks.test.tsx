import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { MyTasks, type AssignedTask } from './MyTasks';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const today = new Date().toISOString().slice(0, 10);
const task = (overrides: Partial<AssignedTask> = {}): AssignedTask => ({ task_id: 1, case_id: 7, case_title: 'Edge investigation', case_severity: 'high', case_status: 'investigating', case_due_date: '2099-01-01', title: 'Collect host evidence', due_date: '2020-01-01', created_at: '2026-11-19T08:00:00Z', ...overrides });
const data = [task(), task({ task_id: 2, case_id: 8, case_title: 'Gateway review', title: 'Review access', due_date: null, case_severity: 'low' }), task({ task_id: 3, title: 'Block persistence', due_date: today }), task({ task_id: 4, title: 'Verify recovery', due_date: '2099-01-01' })];
const mount = () => render(<MemoryRouter><MyTasks /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data }); });
afterEach(cleanup);

describe('MyTasks workspace', () => {
  it('loads only the owner task endpoint and exposes investigation links with separate due dates', async () => {
    mount();
    await screen.findByText('Collect host evidence');
    expect(get).toHaveBeenCalledWith('/cases/my-tasks');
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('link', { name: /Edge investigation/ })[0].getAttribute('href')).toBe('/cases/7?task=1');
    expect(screen.getByText('Task #1 due: 2020-01-01')).toBeTruthy();
    expect(screen.getAllByText('Investigation due: 2099-01-01')).toHaveLength(4);
    expect(screen.getByText(/up to 200 assigned tasks/)).toBeTruthy();
    expect(screen.getByText(/4 of 4 returned tasks match/)).toBeTruthy();
  });

  it('distinguishes failed loading from empty and retries', async () => {
    get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data: [] });
    mount();
    await screen.findByText('Assigned tasks unavailable');
    expect(screen.queryByText('No assigned tasks returned')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No assigned tasks returned');
    expect(screen.queryByText('Assigned tasks unavailable')).toBeNull();
  });

  it('filters task due dates rather than the parent investigation due date', async () => {
    mount();
    await screen.findByLabelText('Task due scope');
    for (const [value, title] of [['overdue', 'Collect host evidence'], ['today', 'Block persistence'], ['future', 'Verify recovery'], ['none', 'Review access']]) {
      fireEvent.change(screen.getByLabelText('Task due scope'), { target: { value } });
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('combines severity and search, distinguishes no matches, and clears filters', async () => {
    mount();
    const input = await screen.findByLabelText('Find assigned work');
    fireEvent.change(input, { target: { value: 'GATEWAY' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Investigation severity'), { target: { value: 'high' } });
    expect(screen.getByText('No returned tasks match')).toBeTruthy();
    expect(screen.queryByText('No assigned tasks returned')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear task filters' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.change(input, { target: { value: '7' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('orders by due date with undated work last and can restore returned order', async () => {
    mount();
    const order = await screen.findByLabelText('Assigned task order');
    fireEvent.change(order, { target: { value: 'due' } });
    expect(screen.getAllByRole('listitem').map(el => el.querySelector('h2')?.textContent)).toEqual(['Collect host evidence', 'Block persistence', 'Verify recovery', 'Review access']);
    fireEvent.change(order, { target: { value: 'title' } });
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('Block persistence');
    fireEvent.click(screen.getByRole('button', { name: 'Clear task filters' }));
    expect(screen.getAllByRole('listitem')[1].textContent).toContain('Review access');
  });

  it('warns when the known endpoint cap is reached', async () => {
    get.mockResolvedValue({ data: Array.from({ length: 200 }, (_, i) => task({ task_id: i + 1 })) });
    mount();
    await screen.findByText(/200-task return limit was reached/);
    expect(screen.getAllByRole('listitem')).toHaveLength(200);
  });

  it('refreshes from the source without keeping old task rows after failure', async () => {
    mount();
    await screen.findByText('Collect host evidence');
    get.mockRejectedValueOnce(new Error('Offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }));
    await screen.findByText('Assigned tasks unavailable');
    expect(screen.queryByText('Collect host evidence')).toBeNull();
    get.mockResolvedValueOnce({ data: [task({ title: 'Fresh task' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Fresh task');
    expect(screen.queryByText('Collect host evidence')).toBeNull();
  });

  it('shows loading and ignores completion after unmount', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = mount();
    expect(screen.getByRole('status', { name: 'Loading assigned tasks' })).toBeTruthy();
    view.unmount();
    await act(async () => { finish({ data }); });
    await waitFor(() => expect(screen.queryByText('Collect host evidence')).toBeNull());
  });
});

const account = { id: 5, email: 'owner@example.test', role: 'analyst', org_id: null, is_active: true };
function reviewedSource() { get.mockImplementation(async url => ({ data: url === '/auth/me' ? account : data })); }
function result(taskId: number, change: { done?: boolean; due_date?: string | null } = {}) { const row = data.find(item => item.task_id === taskId)!; return { status: 200, data: { id: taskId, case_id: row.case_id, title: row.title, done: change.done ?? false, due_date: change.due_date === undefined ? row.due_date : change.due_date, assignee_id: 5, completed_at: change.done ? '2026-11-23T00:00:00Z' : null } }; }
async function reviewOne() { fireEvent.click(await screen.findByLabelText('Complete task #1: Collect host evidence')); await screen.findByRole('dialog', { name: 'Review exact assigned snapshot changes' }); }
const confirm = (count = 1) => screen.getByRole('button', { name: `Confirm ${count} reviewed task changes` });
it('reviews single completion before one conditional update and pauses both views afterward', async () => {
  reviewedSource(); vi.mocked(apiClient.patch).mockResolvedValue(result(1, { done: true })); mount(); await reviewOne();
  expect(apiClient.patch).not.toHaveBeenCalled(); expect(screen.getByRole('dialog').textContent).toContain('Current account #5');
  const button = confirm(); fireEvent.click(button); fireEvent.click(button);
  await screen.findByText(/Verified 1 of 1 reviewed task changes/);
  expect(apiClient.patch).toHaveBeenCalledExactlyOnceWith('/cases/assigned-task-explorer/1', { case_id: 7, expected_title: data[0].title, expected_done: false, expected_due_date: '2020-01-01', expected_case_title: 'Edge investigation', expected_case_status: 'investigating', action: 'complete', due_date: null });
  expect(screen.queryByText('Collect host evidence')).toBeNull(); expect(screen.getByText(/Snapshot controls are paused/)).toBeTruthy();
});
it('reviews exact due clearing and keeps the draft on cancel', async () => {
  reviewedSource(); vi.mocked(apiClient.patch).mockResolvedValue(result(1, { due_date: null })); mount(); const input = await screen.findByLabelText('Task due date for #1'); fireEvent.change(input, { target: { value: '' } }); fireEvent.click(screen.getByLabelText('Save due date for task #1')); await screen.findByRole('dialog'); expect(apiClient.patch).not.toHaveBeenCalled(); expect(screen.getByRole('dialog').textContent).toContain('2020-01-01 → Clear to not set'); fireEvent.click(screen.getByRole('button', { name: 'Cancel task review' })); expect(input).toHaveProperty('value', ''); fireEvent.click(screen.getByLabelText('Save due date for task #1')); await screen.findByRole('dialog'); fireEvent.click(confirm()); await screen.findByText(/Verified 1 of 1/); expect(screen.getByText('Task #1 due: Not set')).toBeTruthy(); expect(apiClient.patch).toHaveBeenCalledWith('/cases/assigned-task-explorer/1', expect.objectContaining({ action: 'clear_due', due_date: null }));
});
it('freezes exact selected identities and hidden count before completion', async () => {
  reviewedSource(); vi.mocked(apiClient.patch).mockImplementation(async url => result(Number(url.split('/').pop()), { done: true })); mount(); fireEvent.click(await screen.findByLabelText('Select task #1: Collect host evidence')); fireEvent.click(screen.getByLabelText('Select task #2: Review access')); fireEvent.change(screen.getByLabelText('Find assigned work'), { target: { value: 'Collect' } }); fireEvent.click(screen.getByRole('button', { name: 'Review selected completion' })); await screen.findByRole('dialog'); expect(screen.getByRole('dialog').textContent).toContain('2 exact tasks from the loaded snapshot, including 1 hidden'); expect(apiClient.patch).not.toHaveBeenCalled(); fireEvent.click(confirm(2)); await screen.findByText(/Verified 2 of 2/); expect(vi.mocked(apiClient.patch).mock.calls.map(([url]) => url)).toEqual(['/cases/assigned-task-explorer/1', '/cases/assigned-task-explorer/2']);
});
it.each(['account', 'title', 'date', 'missing', 'caseStatus', 'offline'])('prevents every mutation if preflight %s changes', async mode => {
  reviewedSource(); mount(); await reviewOne(); get.mockImplementation(async url => {
    if (mode === 'offline') throw Error('PRIVATE');
    return { data: url === '/auth/me' ? { ...account, ...(mode === 'account' ? { id: 9 } : {}) } : mode === 'missing' ? [] : data.map(row => row.task_id !== 1 ? row : { ...row, ...(mode === 'title' ? { title: 'Changed' } : mode === 'date' ? { due_date: null } : mode === 'caseStatus' ? { case_status: 'triage' } : {}) }) };
  }); fireEvent.click(confirm()); await screen.findByText(/No task mutation was sent/); expect(apiClient.patch).not.toHaveBeenCalled(); expect(screen.getByText('Collect host evidence')).toBeTruthy(); expect(document.body.textContent).not.toContain('PRIVATE');
});
it('stops a non-atomic batch at the first unknown response, keeps later tasks unattempted and forbids retry until refresh', async () => {
  reviewedSource(); vi.mocked(apiClient.patch).mockResolvedValueOnce(result(1, { done: true })).mockRejectedValueOnce(Error('PRIVATE')); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Select matching tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Review selected completion' })); await screen.findByRole('dialog'); fireEvent.click(confirm(4)); await screen.findByText(/Verified 1 of 4 reviewed task changes/); expect(screen.getByText(/Processing stopped; later tasks were not sent/)).toBeTruthy(); expect(apiClient.patch).toHaveBeenCalledTimes(2); expect(screen.getByText(/3 selected in the loaded set/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Review selected completion' }).matches(':disabled')).toBe(true); expect(screen.queryByText('Collect host evidence')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' })); await waitFor(() => expect(screen.queryByText(/Snapshot controls are paused/)).toBeNull()); expect(apiClient.patch).toHaveBeenCalledTimes(2);
});
it.each(['status', 'foreignTask', 'foreignAssignee', 'wrongDone', 'wrongDue', 'missingTimestamp'])('refuses unverified response %s without optimistic removal', async mode => {
  reviewedSource(); const response = result(1, { done: true }); if (mode === 'status') response.status = 201; if (mode === 'foreignTask') response.data.id = 9; if (mode === 'foreignAssignee') response.data.assignee_id = 9; if (mode === 'wrongDone') response.data.done = false; if (mode === 'wrongDue') response.data.due_date = null; if (mode === 'missingTimestamp') response.data.completed_at = null; vi.mocked(apiClient.patch).mockResolvedValue(response); mount(); await reviewOne(); fireEvent.click(confirm()); await screen.findByText(/Verified 0 of 1/); expect(screen.getByText('Collect host evidence')).toBeTruthy(); expect(apiClient.patch).toHaveBeenCalledOnce();
});
it('blocks review when identity cannot be established and retains due draft', async () => { mount(); const input = await screen.findByLabelText('Task due date for #1'); fireEvent.change(input, { target: { value: '2099-03-04' } }); fireEvent.click(screen.getByLabelText('Save due date for task #1')); await screen.findByText(/current account could not be verified/); expect(input).toHaveProperty('value', '2099-03-04'); expect(apiClient.patch).not.toHaveBeenCalled(); });
it('blocks a selected due operation while selected row drafts exist', async () => { reviewedSource(); mount(); fireEvent.click(await screen.findByLabelText('Select task #1: Collect host evidence')); fireEvent.change(screen.getByLabelText('Task due date for #1'), { target: { value: '2099-03-04' } }); fireEvent.change(screen.getByLabelText('Selected task date action'), { target: { value: 'clear' } }); expect(screen.getByRole('button', { name: 'Review date change' })).toHaveProperty('disabled', true); expect(apiClient.patch).not.toHaveBeenCalled(); });
it('ignores late preflight results after unmount without a write', async () => { reviewedSource(); const view = mount(); await reviewOne(); let finish!: (value: unknown) => void; get.mockImplementation(() => new Promise(resolve => { finish = resolve; })); fireEvent.click(confirm()); view.unmount(); await act(async () => finish({ data })); expect(apiClient.patch).not.toHaveBeenCalled(); });
it('reviews bulk date setting with each original date and sends only selected conditional changes', async () => {
  reviewedSource(); vi.mocked(apiClient.patch).mockImplementation(async url => result(Number(url.split('/').pop()), { due_date: '2099-03-04' })); mount(); fireEvent.click(await screen.findByLabelText('Select task #1: Collect host evidence')); fireEvent.click(screen.getByLabelText('Select task #2: Review access')); fireEvent.change(screen.getByLabelText('Due date for selected tasks'), { target: { value: '2099-03-04' } }); fireEvent.click(screen.getByRole('button', { name: 'Review date change' })); await screen.findByRole('dialog'); expect(screen.getByRole('dialog').textContent).toContain('2020-01-01 → 2099-03-04'); expect(screen.getByRole('dialog').textContent).toContain('not set → 2099-03-04'); fireEvent.click(confirm(2)); await screen.findByText(/Verified 2 of 2/); expect(vi.mocked(apiClient.patch).mock.calls.map(([, body]) => body)).toEqual([expect.objectContaining({ action: 'set_due', due_date: '2099-03-04', expected_due_date: '2020-01-01' }), expect.objectContaining({ action: 'set_due', due_date: '2099-03-04', expected_due_date: null })]);
});
it('fails closed on a malformed initial task snapshot', async () => { get.mockResolvedValue({ data: [{ task_id: 1 }] }); mount(); await screen.findByText('Assigned tasks unavailable'); expect(screen.queryByLabelText('Task due date for #1')).toBeNull(); expect(apiClient.patch).not.toHaveBeenCalled(); });
it('refresh resets the independent workload explorer so stale page edits cannot resume', async () => {
  get.mockImplementation(async (url, config) => url === '/auth/me' ? { data: account } : url === '/cases/my-tasks' ? { data } : { data: { data: [{ ...data[0], done: false, completed_at: null }], total: 1, page: 1, size: 25, completion: 'open', investigations: 'active', filter_date: (config?.params as { today: string }).today } });
  mount(); await screen.findByText('Collect host evidence'); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); await screen.findByRole('button', { name: 'Edit assigned task #1' }); fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' })); await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit assigned task #1' })).toBeNull()); expect(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' }).getAttribute('aria-expanded')).toBe('false'); expect(apiClient.patch).not.toHaveBeenCalled();
});
