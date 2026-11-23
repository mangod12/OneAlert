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

  it('shows no delete button for a completed plan', async () => {
    mockLoad('completed');
    render(<ResponsePlans />);
    await screen.findByText('Case #4');
    expect(screen.queryByRole('button', { name: /Delete plan/ })).toBeNull();
  });

  it('cancelling the execute dialog leaves the plan untouched', async () => {
    mockLoad('approved');
    post.mockResolvedValue({ data: {} });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Execute' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close simulation review' }));
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
    expect(get).toHaveBeenCalledWith('/response-plans/pending-approvals', { params: { page: 1, size: 10 } });
    fireEvent.change(screen.getByLabelText('Filter plans by status'), { target: { value: 'completed' } });
    expect(await screen.findByText('Case #1')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20, status: 'completed' } });
  });
  it('returns to the last existing page when the current final page disappears', async () => {
    let count = 21;
    get.mockImplementation(async (url, config) => {
      if (url === '/auth/me') return { data: { id: 5, email: 'reviewer@example.test', role: 'analyst', org_id: null, is_active: true } };
      if (url.endsWith('/deletion-review')) return { data: { plan: { ...plan, status: 'draft' }, approval_count: 0, approval_status_counts: {}, deletion_fingerprint: 'f'.repeat(64) } };
      if (url.endsWith('pending-approvals')) return { data: { data: [] } };
      const page = (config?.params as { page: number }).page;
      return { data: { data: count === 20 && page === 2 ? [] : [{ ...plan, status: 'draft' }], total: count } };
    });
    post.mockImplementation(async () => { count = 20; return { status: 200, data: { success: true, deleted: true, plan_id: 12, case_id: 4, approvals_deleted: 0 } }; });
    render(<ResponsePlans />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next plans' }));
    await screen.findByText('Showing 21–21 of 21 matching plans · Page 2 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan 12' }));
    fireEvent.change(await screen.findByLabelText('Type DELETE 12'), { target: { value: 'DELETE 12' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently remove reviewed plan' }));
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

it('removes stale plans and detail if the current status-filter read fails', async () => {
  let fail = false;
  get.mockImplementation(url => url.endsWith('pending-approvals') ? Promise.resolve({ data: { data: [] } }) : fail ? Promise.reject(new Error('Current plan read unavailable')) : Promise.resolve({ data: { data: [plan], total: 1 } }));
  render(<ResponsePlans />);
  fireEvent.click(await screen.findByText('Case #4'));
  expect(screen.getByText('plant-gateway')).toBeTruthy();
  fail = true;
  fireEvent.change(screen.getByLabelText('Filter plans by status'), { target: { value: 'draft' } });
  await screen.findByText('Current plan read unavailable');
  expect(screen.queryByText('Case #4')).toBeNull();
  expect(screen.queryByText('plant-gateway')).toBeNull();
  expect(screen.queryByText('No response plans')).toBeNull();
});

it('removes stale approval requests when an approval queue refresh fails', async () => {
  let fail = false;
  get.mockImplementation(url => url.endsWith('pending-approvals') ? fail ? Promise.reject(new Error('Approval refresh unavailable')) : Promise.resolve({ data: { data: [{ id: 7, plan_id: 12, case_id: 4, reason: 'Old approval request', actions: [], autonomy_level: 'L2' }] } }) : Promise.resolve({ data: { data: [plan], total: 1 } }));
  render(<ResponsePlans />);
  await screen.findByText('Old approval request');
  fail = true;
  fireEvent.change(screen.getByLabelText('Filter plans by status'), { target: { value: 'approved' } });
  await screen.findByText('Approval refresh unavailable');
  expect(screen.queryByText('Old approval request')).toBeNull();
  expect(screen.getByText('Case #4')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('exports selected recorded action evidence locally without executing or fetching a plan', async () => {
  get.mockImplementation(url => Promise.resolve({ data: { data: url.endsWith('pending-approvals') ? [] : [plan], total: 1 } }));
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:actions'), configurable: true }); Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ResponsePlans />);
  fireEvent.click(await screen.findByText('Case #4'));
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Export recorded action evidence' }));
  expect(click).toHaveBeenCalledOnce();
  expect(get.mock.calls.length).toBe(reads);
  expect(post).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
});

const approval = { review_fingerprint: 'a'.repeat(64), id: 7, plan_id: 12, case_id: 4, status: 'pending', reason: 'Contain the incident', autonomy_level: 'L2', created_at: '2026-11-20T10:00:00Z', actions: plan.actions };
function loadApproval(actions = approval.actions) {
  get.mockImplementation(async url => ({ data: { data: url.endsWith('pending-approvals') ? [{ ...approval, actions }] : [{ ...plan, status: 'pending_approval' }] } }));
}

it('requires action review and acknowledgement before approving without executing', async () => {
  loadApproval();
  post.mockResolvedValue({ data: { success: true, plan_status: 'approved' } });
  render(<ResponsePlans />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  expect(screen.getByText('Target: plant-gateway')).toBeTruthy();
  expect(screen.getByText('Recorded policy check: not recorded')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
  const approve = screen.getByRole('button', { name: 'Approve reviewed plan #12' }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('I reviewed the saved actions and targets for plan #12.'));
  fireEvent.click(approve);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/response-plans/12/approve', { reviewed_fingerprint: 'a'.repeat(64) }));
  expect(post).toHaveBeenCalledTimes(1);
});

it('blocks approval when action evidence is empty', async () => {
  loadApproval([]);
  render(<ResponsePlans />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  expect(screen.getByText(/No saved actions were returned/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Approve reviewed plan #12' }) as HTMLButtonElement).disabled).toBe(true);
});

it('does not report approval success without a verified server state', async () => {
  loadApproval();
  post.mockResolvedValue({ data: {} });
  render(<ResponsePlans />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  fireEvent.click(screen.getByLabelText('I reviewed the saved actions and targets for plan #12.'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve reviewed plan #12' }));
  await screen.findByText(/Approval returned without a confirmed approved state/);
  expect(screen.queryByRole('button', { name: 'Approve reviewed plan #12' })).toBeNull();
});

it('keeps review open with an explicit error when approval fails', async () => {
  loadApproval();
  post.mockRejectedValue(new Error('Approval unavailable'));
  render(<ResponsePlans />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  fireEvent.click(screen.getByLabelText('I reviewed the saved actions and targets for plan #12.'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve reviewed plan #12' }));
  await screen.findByText('Approval unavailable');
  expect(screen.getByRole('region', { name: 'Approval review for plan 12' })).toBeTruthy();
});

it('blocks approval when the backend did not provide a review fingerprint', async () => {
  get.mockImplementation(async url => ({ data: { data: url.endsWith('pending-approvals') ? [{ ...approval, review_fingerprint: undefined }] : [plan] } }));
  render(<ResponsePlans />); fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  expect(screen.getByText(/Review fingerprint unavailable/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Approve reviewed plan #12' }) as HTMLButtonElement).disabled).toBe(true);
  expect(post).not.toHaveBeenCalled();
});
it('closes stale review on conflict and requires a fresh acknowledgement', async () => {
  loadApproval(); post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { detail: 'The saved plan changed after review. Refresh and review it again.' } } });
  render(<ResponsePlans />); fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  fireEvent.click(screen.getByLabelText('I reviewed the saved actions and targets for plan #12.'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve reviewed plan #12' }));
  await screen.findByText('The saved plan changed after review. Refresh and review it again.');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve reviewed plan #12' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Review approval' }));
  expect((screen.getByLabelText('I reviewed the saved actions and targets for plan #12.') as HTMLInputElement).checked).toBe(false);
  expect(post).toHaveBeenCalledTimes(1);
});
it('makes all fingerprint-bound action fields inspectable rather than hiding extra recorded details', async () => {
  const recordedAction = { ...plan.actions[0], priority: 0, policy_check: { approved: false }, retained_parameter: 'review-me' };
  loadApproval([recordedAction]);
  render(<ResponsePlans />); fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  expect(screen.getByText('Recorded priority: 0')).toBeTruthy();
  expect(screen.getByText(/"retained_parameter": "review-me"/)).toBeTruthy();
});

it('pages approval requests separately from the plan list and closes the previous review', async () => {
  get.mockImplementation(async (url, config) => {
    if (url.endsWith('pending-approvals')) {
      const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
      return { data: { data: [{ ...approval, id: page, plan_id: page === 1 ? 12 : 13 }], total: 11, page, size: 10 } };
    }
    return { data: { data: [plan], total: 1 } };
  });
  render(<ResponsePlans />); fireEvent.click(await screen.findByRole('button', { name: 'Review approval' }));
  fireEvent.click(screen.getByLabelText('I reviewed the saved actions and targets for plan #12.'));
  fireEvent.click(screen.getByRole('button', { name: 'Next approval page' }));
  await screen.findByText('Plan #13 — Case #4');
  expect(screen.queryByRole('region', { name: 'Approval review for plan 12' })).toBeNull();
  expect(get).toHaveBeenCalledWith('/response-plans/pending-approvals', { params: { page: 2, size: 10 } });
  expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20 } });
  expect((screen.getByRole('button', { name: 'Next approval page' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/including records on other pages/)).toBeTruthy();
});
it('recovers the last approval page when resolving a plan removes the remaining rows', async () => {
  let resolved = false;
  get.mockImplementation(async (url, config) => {
    if (url.endsWith('pending-approvals')) {
      const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
      return { data: { data: resolved && page === 2 ? [] : [{ ...approval, id: page }], total: resolved ? 1 : 11, page, size: 10 } };
    }
    return { data: { data: [plan], total: 1 } };
  });
  post.mockImplementation(async () => { resolved = true; return { data: { success: true, plan_status: 'approved' } }; });
  render(<ResponsePlans />); fireEvent.click(await screen.findByRole('button', { name: 'Next approval page' }));
  await screen.findByText(/Approval page 2 of 2/);
  fireEvent.click(screen.getByRole('button', { name: 'Review approval' }));
  fireEvent.click(screen.getByLabelText('I reviewed the saved actions and targets for plan #12.'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve reviewed plan #12' }));
  await screen.findByText(/Approval page 1 of 1/);
  expect((screen.getByRole('button', { name: 'Previous approval page' }) as HTMLButtonElement).disabled).toBe(true);
});
it('does not present a mismatched approval page as reviewable evidence', async () => {
  get.mockImplementation(async url => ({ data: url.endsWith('pending-approvals') ? { data: [approval], total: 11, page: 2, size: 10 } : { data: [plan], total: 1 } }));
  render(<ResponsePlans />);
  await screen.findByText('The approval response did not match the requested page. Retry before making a decision.');
  expect(screen.queryByRole('button', { name: 'Review approval' })).toBeNull();
});
it('renders structured legacy action values without crashing or inventing priority', async () => {
  const unusual = { toString: 'legacy-data' };
  get.mockImplementation(url => Promise.resolve({ data: { data: url.endsWith('pending-approvals') ? [] : [{ ...plan, actions: [{ action_type: unusual, target: unusual, reason: unusual, priority: 0, execution_result: { status: unusual, detail: unusual, executed_at: unusual } }, { action_type: 'notify_soc' }] }] } }));
  render(<ResponsePlans />);
  fireEvent.click(await screen.findByText('Case #4'));
  expect(screen.getByText('Position 1, recorded priority: 0')).toBeTruthy();
  expect(screen.getByText('Position 2, recorded priority: Not recorded')).toBeTruthy();
  expect(screen.getAllByText(JSON.stringify(unusual)).length).toBeGreaterThan(3);
});
it('opens fresh exact-plan rejection review from the pending queue and refreshes after verified rejection', async () => {
  const current = { ...plan, status: 'pending_approval' }; let saved = false;
  get.mockImplementation(async url => ({ data: url === '/auth/me' ? { id: 5, email: 'reviewer@example.test', role: 'analyst', org_id: null, is_active: true } : url.endsWith('/approval-review') ? { plan: current, review_fingerprint: 'f'.repeat(64) } : { data: url.endsWith('/pending-approvals') ? saved ? [] : [{ id: 7, plan_id: 12, case_id: 4, reason: 'Original request', actions: current.actions, autonomy_level: 'L2' }] : [{ ...current, status: saved ? 'rejected' : current.status }], total: saved && url.endsWith('/pending-approvals') ? 0 : 1 } }));
  post.mockImplementation(async () => { saved = true; return { status: 200, data: { success: true, plan_status: 'rejected', plan_id: 12, case_id: 4, approvals_resolved: 1 } }; });
  render(<ResponsePlans />); fireEvent.click(await screen.findByRole('button', { name: 'Reject' })); await screen.findByLabelText('Reason for rejection (optional)'); expect(get).toHaveBeenCalledWith('/response-plans/12/approval-review'); expect(post).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Review exact rejection reason' })); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed rejection' })); await screen.findByText(/Rejection recorded for plan #12/); await screen.findByText('rejected'); expect(post).toHaveBeenCalledExactlyOnceWith('/response-plans/12/reject-reviewed', { reviewed_fingerprint: 'f'.repeat(64), reason: '' });
});

it('loads fresh simulation evidence instead of executing a list snapshot', async () => {
  get.mockImplementation(async url => ({ data: url.endsWith('/auth/me') ? { id: 5, email: 'a@example.test', role: 'analyst', org_id: 7, is_active: true } : url.endsWith('/simulation-review') ? { plan, execution_mode: 'simulated', reviewed_fingerprint: 'f'.repeat(64), preflight: { action_count: 1, supported_count: 1, unsupported_count: 0, invalid_count: 0, shape_valid: true, order_available: true, records: [{ source_position: 1, action_type: 'isolate_host', target: 'plant-gateway', priority: 99, simulation_order: 1, shape_valid: true, handler_available: true }] } } : { data: url.endsWith('pending-approvals') ? [] : [plan] } }));
  render(<ResponsePlans />); fireEvent.click(await screen.findByRole('button', { name: 'Execute' }));
  expect(await screen.findByText(/1 saved actions/)).toBeTruthy(); expect(get).toHaveBeenCalledWith('/response-plans/12/simulation-review');
  expect(screen.getByRole('button', { name: 'Run reviewed local simulation' })).toHaveProperty('disabled', true); expect(post).not.toHaveBeenCalled();
});
