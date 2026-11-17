import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponsePlans } from './ResponsePlans';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const plan = {
  id: 12, case_id: 4, status: 'approved', autonomy_level: 'L2',
  created_at: '2026-11-17T08:00:00Z', actions: [{
    action_type: 'isolate_host', target: 'plant-gateway', reason: 'Contain traffic',
  }],
};
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Response plan refresh safety', () => {
  it('keeps an approval error visible when the slower plans request succeeds', async () => {
    let resolvePlans!: (value: unknown) => void;
    get.mockImplementation(url => url.endsWith('pending-approvals')
      ? Promise.reject(new Error('Approval queue unavailable'))
      : new Promise(resolve => { resolvePlans = resolve; }));
    render(<ResponsePlans />);
    expect(screen.queryByText('No response plans')).toBeNull();
    resolvePlans({ data: { data: [plan] } });
    expect(await screen.findByText('Approval queue unavailable')).toBeTruthy();
    expect(screen.getByText('Case #4')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Execute' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not show an empty-state success alongside a failed load', async () => {
    get.mockRejectedValue(new Error('Service unavailable'));
    render(<ResponsePlans />);
    expect(await screen.findByText('Response plans unavailable')).toBeTruthy();
    expect(screen.queryByText('No response plans')).toBeNull();
  });

  it('refreshes the open detail from current plans after execution', async () => {
    let executed = false;
    get.mockImplementation(url => Promise.resolve({ data: { data:
      url.endsWith('pending-approvals') ? [] : [{ ...plan, actions: [{ ...plan.actions[0],
        ...(executed ? { execution_result: { status: 'completed' } } : {}),
      }] }],
    } }));
    post.mockImplementation(async () => { executed = true; return { data: {} }; });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByText('Case #4'));
    expect(screen.queryByText('completed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    expect(await screen.findByText('completed')).toBeTruthy();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/response-plans/12/execute'));
  });
});
