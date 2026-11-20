import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponsePlans } from './ResponsePlans';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const del = vi.mocked(apiClient.delete);
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
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByText('Case #4'));
    expect(screen.queryByText('completed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Execute now' }));
    expect(await screen.findByText('completed')).toBeTruthy();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/response-plans/12/execute'));
  });
});

describe('Response plan confirmation dialogs', () => {
  const pendingApproval = {
    id: 7, plan_id: 12, case_id: 4, status: 'pending', reason: 'Agent requests approval',
    autonomy_level: 'L2', created_at: '2026-11-17T08:00:00Z',
    actions: [{ action_type: 'isolate_host', target: 'plant-gateway', reason: 'Contain traffic' }],
  };

  const mockLoad = (planStatus = 'pending_approval') => {
    get.mockImplementation(url => Promise.resolve({ data: { data:
      url.endsWith('pending-approvals') ? [pendingApproval] : [{ ...plan, status: planStatus }],
    } }));
  };

  it('deletes a draft plan after confirmation', async () => {
    mockLoad('draft');
    del.mockResolvedValue({ data: {} });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete plan 12' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete plan' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/response-plans/12'));
  });

  it('shows no delete button for a completed plan', async () => {
    mockLoad('completed');
    render(<ResponsePlans />);
    await screen.findByText('Case #4');
    expect(screen.queryByRole('button', { name: /Delete plan/ })).toBeNull();
  });

  it('sends the typed reason when rejecting a plan', async () => {
    mockLoad();
    post.mockResolvedValue({ data: {} });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Reason for rejection (optional)'), {
      target: { value: 'Freeze window conflict' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject plan' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/response-plans/12/reject', { reason: 'Freeze window conflict' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dialog).toBeTruthy();
  });

  it('falls back to a default reason when none is typed', async () => {
    mockLoad();
    post.mockResolvedValue({ data: {} });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject plan' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/response-plans/12/reject', { reason: 'Manual rejection' }));
  });

  it('closes on Escape without calling the API', async () => {
    mockLoad();
    post.mockResolvedValue({ data: {} });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).not.toHaveBeenCalled();
  });

  it('cancelling the execute dialog leaves the plan untouched', async () => {
    mockLoad('approved');
    post.mockResolvedValue({ data: {} });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Execute' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).not.toHaveBeenCalled();
  });
});

describe('Status filter', () => {
  it('sends the chosen status to the API', async () => {
    get.mockImplementation(url => Promise.resolve({ data: { data: url.endsWith('pending-approvals') ? [] : [plan] } }));
    render(<ResponsePlans />);
    const select = await screen.findByLabelText('Filter plans by status');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20 } }));
    fireEvent.change(select, { target: { value: 'pending_approval' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20, status: 'pending_approval' } });
    });
  });
});

describe('Response plan CSV export', () => {
  it('downloads the CSV honoring the active status filter', async () => {
    const createUrl = vi.fn(() => 'blob:plans');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrl, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    get.mockImplementation(async (url: string) => {
      if (url === '/response-plans/') return { data: { data: [plan], total: 1 } };
      if (url === '/response-plans/pending-approvals') return { data: { data: [] } };
      if (url === '/response-plans/export') return { data: new Blob(['id,status'], { type: 'text/csv' }) };
      throw new Error(`unexpected ${url}`);
    });
    render(<ResponsePlans />);
    const button = await screen.findByRole('button', { name: /export csv/i });
    fireEvent.change(screen.getByRole('combobox', { name: /filter plans by status/i }), { target: { value: 'approved' } });
    await screen.findByRole('button', { name: /export csv/i });
    fireEvent.click(button);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/response-plans/export', { params: { status: 'approved' }, responseType: 'blob' }));
    await waitFor(() => expect(createUrl).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalled();
  });
});


describe('Response execution outcome feedback', () => {
  it.each([
    [{ plan_id: 12, status: 'completed', total_actions: 2, succeeded: 2, failed: 0 }, '2 of 2 actions succeeded; 0 failed or skipped', 'status'],
    [{ plan_id: 12, status: 'partial', total_actions: 2, succeeded: 1, failed: 1 }, '1 of 2 actions succeeded; 1 failed or skipped', 'alert'],
    [{ plan_id: 12, status: 'partial', total_actions: 2, succeeded: 0, failed: 2 }, '0 of 2 actions succeeded; 2 failed or skipped', 'alert'],
    [{ plan_id: 999, status: 'completed', total_actions: 1, succeeded: 1, failed: 0 }, 'without a verifiable outcome', 'alert'],
    [{ plan_id: 12, status: 'completed', total_actions: 2, succeeded: 2, failed: 1 }, 'without a verifiable outcome', 'alert'],
    [undefined, 'without a verifiable outcome', 'alert'],
  ])('shows the returned outcome without assuming HTTP success means execution success', async (outcome, message, role) => {
    get.mockImplementation(url => Promise.resolve({ data: { data: url.endsWith('pending-approvals') ? [] : [plan] } }));
    post.mockResolvedValue({ data: { data: outcome } });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Execute' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Execute now' }));
    const notice = await screen.findByText(new RegExp(message));
    expect(notice.getAttribute('role')).toBe(role);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Plan executed successfully')).toBeNull();
  });
});


describe('Response plan latest-filter results', () => {
  it.each(['success', 'failure'])('ignores a slower obsolete %s after the selected status loads', async oldResult => {
    let resolveOld!: (value: unknown) => void;
    let rejectOld!: (error: Error) => void;
    get.mockImplementation((url, config) => {
      if (url.endsWith('pending-approvals')) return Promise.resolve({ data: { data: [] } });
      if (!(config?.params as { status?: string })?.status) return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
      return Promise.resolve({ data: { data: [{ ...plan, status: 'completed' }] } });
    });
    render(<ResponsePlans />);
    fireEvent.change(screen.getByLabelText('Filter plans by status'), { target: { value: 'completed' } });
    expect(await screen.findByText('completed')).toBeTruthy();
    await act(async () => {
      if (oldResult === 'success') resolveOld({ data: { data: [{ ...plan, status: 'approved' }] } });
      else rejectOld(new Error('Obsolete load failed'));
    });
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull();
    expect(screen.queryByText('Obsolete load failed')).toBeNull();
  });
});

describe('Response plan pagination', () => {
  it('reaches plans after the first twenty and keeps the approval queue independent', async () => {
    get.mockImplementation(async (url, config) => {
      if (url.endsWith('pending-approvals')) return { data: { data: [] } };
      const page = (config?.params as { page: number }).page;
      return { data: { data: [{ ...plan, id: page, case_id: page }], total: 21 } };
    });
    render(<ResponsePlans />);
    await screen.findByText('Case #1');
    expect((screen.getByRole('button', { name: 'Previous plans' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next plans' }));
    expect(await screen.findByText('Case #2')).toBeTruthy();
    expect(screen.getByText('Showing 21–21 of 21 matching plans · Page 2 of 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next plans' }) as HTMLButtonElement).disabled).toBe(true);
    expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 2, size: 20 } });
    expect(get).toHaveBeenCalledWith('/response-plans/pending-approvals');
    fireEvent.change(screen.getByLabelText('Filter plans by status'), { target: { value: 'completed' } });
    expect(await screen.findByText('Case #1')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20, status: 'completed' } });
  });
  it('returns to the last existing page when the current final page disappears', async () => {
    let count = 21;
    get.mockImplementation(async (url, config) => {
      if (url.endsWith('pending-approvals')) return { data: { data: [] } };
      const page = (config?.params as { page: number }).page;
      return { data: { data: count === 20 && page === 2 ? [] : [{ ...plan, status: 'draft' }], total: count } };
    });
    del.mockImplementation(async () => { count = 20; return { data: {} }; });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next plans' }));
    await screen.findByText('Showing 21–21 of 21 matching plans · Page 2 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan 12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
    expect(await screen.findByText('Showing 1–20 of 20 matching plans · Page 1 of 1')).toBeTruthy();
  });
});


describe('Recorded response action evidence', () => {
  it('shows recorded failure reasons and timestamps without executing again', async () => {
    get.mockImplementation(async url => ({ data: { data: url.endsWith('pending-approvals') ? [] : [{ ...plan, status: 'partial', actions: [{ ...plan.actions[0], execution_result: { status: 'skipped', detail: 'Unknown action type: isolate_host', executed_at: '2026-11-20T00:00:00Z' } }] }] } }));
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByText('Case #4'));
    expect(screen.getByText('Unknown action type: isolate_host')).toBeTruthy();
    expect(screen.getByText('skipped')).toBeTruthy();
    expect(screen.getByText(new Date('2026-11-20T00:00:00Z').toLocaleString())).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
  it('labels missing execution evidence without claiming the action never ran', async () => {
    get.mockImplementation(async url => ({ data: { data: url.endsWith('pending-approvals') ? [] : [plan] } }));
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByText('Case #4'));
    expect(screen.getByText('No execution result recorded')).toBeTruthy();
    expect(screen.getByText(/Missing results do not establish whether an action ran/)).toBeTruthy();
  });
  it('preserves unparseable recorded times and labels missing detail', async () => {
    get.mockImplementation(async url => ({ data: { data: url.endsWith('pending-approvals') ? [] : [{ ...plan, actions: [{ ...plan.actions[0], execution_result: { status: 'error', executed_at: 'unknown-clock' } }] }] } }));
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByText('Case #4'));
    expect(screen.getByText('unknown-clock')).toBeTruthy();
    expect(screen.getByText('No execution detail recorded.')).toBeTruthy();
  });
});
