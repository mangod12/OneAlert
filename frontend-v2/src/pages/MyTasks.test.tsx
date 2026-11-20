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

it('keeps due-date drafts private until saved, supports clear and discard, and updates filters after success', async () => {
  vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 1, case_id: 7, done: false, due_date: null } });
  mount();
  const input = await screen.findByLabelText('Task due date for #1');
  fireEvent.change(input, { target: { value: '2099-02-03' } });
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Complete task #1: Collect host evidence')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByLabelText('Discard due date draft for task #1'));
  expect(input).toHaveProperty('value', '2020-01-01');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByLabelText('Save due date for task #1'));
  await screen.findByText('Saved the due date for task #1.');
  expect(apiClient.patch).toHaveBeenCalledWith('/cases/7/tasks/1', { due_date: null });
  expect(screen.getByText('Task #1 due: Not set')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Task due scope'), { target: { value: 'overdue' } });
  expect(screen.getByText('No returned tasks match')).toBeTruthy();
});

it('does not remove a task before completion succeeds and blocks duplicate and competing saves', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiClient.patch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mount();
  const button = await screen.findByLabelText('Complete task #1: Collect host evidence');
  fireEvent.click(button); fireEvent.click(button);
  expect(screen.getByText('Collect host evidence')).toBeTruthy();
  expect(screen.getByLabelText('Task due date for #1')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Refresh tasks' })).toHaveProperty('disabled', true);
  expect(apiClient.patch).toHaveBeenCalledTimes(1);
  await act(async () => finish({ data: { id: 1, case_id: 7, done: true, due_date: '2020-01-01' } }));
  expect(screen.queryByText('Collect host evidence')).toBeNull();
  expect(screen.getByText(/Completed task #1/)).toBeTruthy();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(apiClient.patch).toHaveBeenCalledWith('/cases/7/tasks/1', { done: true });
});

it('keeps failed due-date drafts and task rows available for retry', async () => {
  vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error('save offline')).mockResolvedValueOnce({ data: { id: 1, case_id: 7, done: false, due_date: '2099-02-03' } });
  mount();
  const input = await screen.findByLabelText('Task due date for #1');
  fireEvent.change(input, { target: { value: '2099-02-03' } });
  fireEvent.click(screen.getByLabelText('Save due date for task #1'));
  await screen.findByRole('alert');
  expect(input).toHaveProperty('value', '2099-02-03');
  expect(screen.getByText('Task #1 due: 2020-01-01')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Save due date for task #1'));
  await screen.findByText('Task #1 due: 2099-02-03');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retains the capped-snapshot warning after completing a returned task', async () => {
  get.mockResolvedValue({ data: Array.from({ length: 200 }, (_, i) => task({ task_id: i + 1 })) });
  vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 1, case_id: 7, done: true, due_date: null } });
  mount();
  fireEvent.click(await screen.findByLabelText('Complete task #1: Collect host evidence'));
  await screen.findByText(/Completed task #1/);
  expect(screen.getAllByRole('listitem')).toHaveLength(199);
  expect(screen.getByText(/200-task return limit was reached/)).toBeTruthy();
});

it('previews selected tasks across filters, confirms the exact count, and applies only to those tasks', async () => {
  vi.mocked(apiClient.patch).mockImplementation(async url => ({ data: { id: Number(url.split('/').pop()), case_id: Number(url.split('/')[2]), done: false, due_date: '2099-03-04' } }));
  mount();
  fireEvent.click(await screen.findByLabelText('Select task #1: Collect host evidence'));
  fireEvent.click(screen.getByLabelText('Select task #2: Review access'));
  fireEvent.change(screen.getByLabelText('Find assigned work'), { target: { value: 'Collect' } });
  expect(screen.getByText(/2 selected in the loaded set; 1 hidden/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Due date for selected tasks'), { target: { value: '2099-03-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review date change' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText(/2099-03-04 for 2 selected loaded tasks, including 1 hidden/)).toBeTruthy();
  expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Review date change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 tasks' }));
  await screen.findByText(/Saved due dates for 2 of 2 selected tasks/);
  expect(vi.mocked(apiClient.patch).mock.calls).toEqual([['/cases/7/tasks/1', { due_date: '2099-03-04' }], ['/cases/8/tasks/2', { due_date: '2099-03-04' }]]);
  expect(screen.getByText('Task #1 due: 2099-03-04')).toBeTruthy();
  expect(screen.getByText(/0 selected in the loaded set/)).toBeTruthy();
});

it('retains failed selections for a targeted retry and updates only confirmed dates', async () => {
  vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: { id: 1, case_id: 7, done: false, due_date: null } }).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data: { id: 2, case_id: 8, done: false, due_date: null } });
  mount();
  fireEvent.click(await screen.findByLabelText('Select task #1: Collect host evidence'));
  fireEvent.click(screen.getByLabelText('Select task #2: Review access'));
  fireEvent.change(screen.getByLabelText('Selected task date action'), { target: { value: 'clear' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review date change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 tasks' }));
  await screen.findByText(/Saved due dates for 1 of 2/);
  expect(screen.getByLabelText('Select task #1: Collect host evidence')).toHaveProperty('checked', false);
  expect(screen.getByLabelText('Select task #2: Review access')).toHaveProperty('checked', true);
  expect(screen.getByText('Task #1 due: Not set')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review date change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 tasks' }));
  await screen.findByText(/Saved due dates for 1 of 1/);
  expect(vi.mocked(apiClient.patch).mock.calls.map(([url]) => url)).toEqual(['/cases/7/tasks/1', '/cases/8/tasks/2', '/cases/8/tasks/2']);
});

it('requires selected row drafts to be saved or discarded before bulk changes', async () => {
  mount();
  fireEvent.click(await screen.findByLabelText('Select task #1: Collect host evidence'));
  fireEvent.change(screen.getByLabelText('Task due date for #1'), { target: { value: '2099-02-02' } });
  fireEvent.change(screen.getByLabelText('Selected task date action'), { target: { value: 'clear' } });
  expect(screen.getByRole('button', { name: 'Review date change' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByLabelText('Discard due date draft for task #1'));
  expect(screen.getByRole('button', { name: 'Review date change' })).toHaveProperty('disabled', false);
  expect(apiClient.patch).not.toHaveBeenCalled();
});

it('limits bulk request concurrency to five and freezes selection until completion', async () => {
  get.mockResolvedValue({ data: Array.from({ length: 6 }, (_, i) => task({ task_id: i + 1, title: `Selected work ${i + 1}` })) });
  const finish: Array<(value: unknown) => void> = [];
  vi.mocked(apiClient.patch).mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Select matching tasks' }));
  fireEvent.change(screen.getByLabelText('Selected task date action'), { target: { value: 'clear' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review date change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 6 tasks' }));
  expect(apiClient.patch).toHaveBeenCalledTimes(5);
  expect(screen.getByLabelText('Find assigned work')).toHaveProperty('disabled', true);
  await act(async () => { finish.slice(0, 5).forEach((resolve, index) => resolve({ data: { id: index + 1, case_id: 7, done: false, due_date: null } })); });
  expect(apiClient.patch).toHaveBeenCalledTimes(6);
  await act(async () => finish[5]({ data: { id: 6, case_id: 7, done: false, due_date: null } }));
  await screen.findByText(/Saved due dates for 6 of 6/);
});

it('confirms completion of the exact selected set including hidden tasks, without changing due dates', async () => {
  vi.mocked(apiClient.patch).mockImplementation(async (url: string) => ({ data: { id: Number(url.split('/').pop()), case_id: Number(url.split('/')[2]), done: true, due_date: null } }));
  mount();
  await screen.findByText('Collect host evidence');
  fireEvent.click(screen.getByRole('button', { name: 'Select matching tasks' }));
  fireEvent.change(screen.getByLabelText('Investigation severity'), { target: { value: 'low' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review selected completion' }));
  expect(screen.getByRole('dialog').textContent).toContain('including 3 hidden');
  expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Complete 4 selected tasks' }));
  await screen.findByText(/Confirmed completion for 4 of 4/);
  expect(apiClient.patch).toHaveBeenCalledTimes(4);
  expect(apiClient.patch).toHaveBeenCalledWith('/cases/7/tasks/1', { done: true });
  expect(screen.getByText('No assigned tasks returned')).toBeTruthy();
});

it('keeps unconfirmed completion responses selected while removing only confirmed successes', async () => {
  vi.mocked(apiClient.patch).mockImplementation(async (url: string) => ({ data: { id: Number(url.split('/').pop()), case_id: Number(url.split('/')[2]), done: !url.endsWith('/2'), due_date: null } }));
  mount();
  await screen.findByText('Collect host evidence');
  fireEvent.click(screen.getByRole('button', { name: 'Select matching tasks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected completion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Complete 4 selected tasks' }));
  await screen.findByText(/Confirmed completion for 3 of 4/);
  expect(screen.getByText(/1 selected in the loaded set/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Review access' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Collect host evidence' })).toBeNull();
  expect(screen.getByText(/Completion was not confirmed for this task/)).toBeTruthy();
});

it('protects date drafts from selected completion and supports cancellation', async () => {
  mount();
  await screen.findByText('Collect host evidence');
  fireEvent.click(screen.getByRole('button', { name: 'Select matching tasks' }));
  fireEvent.change(screen.getByLabelText('Task due date for #1'), { target: { value: '2099-11-20' } });
  expect((screen.getByRole('button', { name: 'Review selected completion' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Discard due date draft for task #1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected completion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(apiClient.patch).not.toHaveBeenCalled();
});

it('does not remove a task or announce success when completion names another investigation', async () => {
  vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 1, case_id: 99, done: true, due_date: null } });
  mount(); fireEvent.click(await screen.findByLabelText('Complete task #1: Collect host evidence'));
  await screen.findByRole('alert'); expect(screen.getByText('Collect host evidence')).toBeTruthy();
  expect(screen.queryByText(/Completed task #1/)).toBeNull();
});
it('keeps bulk date selections and existing dates when returned values do not confirm the requested date', async () => {
  vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 1, case_id: 7, done: false, due_date: '2099-01-01' } });
  mount(); fireEvent.click(await screen.findByLabelText('Select task #1: Collect host evidence'));
  fireEvent.change(screen.getByLabelText('Selected task date action'), { target: { value: 'clear' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review date change' })); fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 tasks' }));
  await screen.findByText(/Saved due dates for 0 of 1/);
  expect(screen.getByText('Task #1 due: 2020-01-01')).toBeTruthy();
  expect(screen.getByLabelText('Select task #1: Collect host evidence')).toHaveProperty('checked', true);
});
