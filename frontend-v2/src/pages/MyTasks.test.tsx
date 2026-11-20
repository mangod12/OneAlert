import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { MyTasks, type AssignedTask } from './MyTasks';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
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
    expect(screen.getAllByRole('link', { name: /Edge investigation/ })[0].getAttribute('href')).toBe('/cases/7');
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
