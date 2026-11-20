import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponseDecisionEvidence } from './ResponseDecisionEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const snapshot = { schema_version: 1, scope: 'Current mutable records, not an immutable decision log.', retrieved_at: '2026-11-20T18:00:00Z', plan: { id: 7, case_id: 10, status: 'partial', autonomy_level: 'L1', created_by: 'Agent label', approved_by: 55, approved_at: null, created_at: '2026-11-20T17:00:00Z', actions: [{ priority: 0, action_type: 'isolate', target: '192.0.2.7', reason: 'Recorded reason', policy_check: { approved: false }, execution_result: { status: 'failed', detail: 'Recorded failure', executed_at: '2026-11-20T18:00:00+05:30' } }, { action_type: 'notify', target: 'local' }] }, approval_page: 1, approval_size: 10, approval_total: 1, approval_records: [{ id: 12, plan_id: 7, requested_by: 'Request actor', status: 'rejected', reason: 'Review window unavailable', reviewed_by: 55, reviewed_at: '2026-11-20T17:30:00Z', created_at: '2026-11-20T17:00:00Z' }] };
const load = async () => { render(<ResponseDecisionEvidence />); fireEvent.change(screen.getByLabelText('Decision evidence plan ID'), { target: { value: '7' } }); fireEvent.click(screen.getByRole('button', { name: 'Load decision evidence' })); await screen.findByText('Plan #7 · Case #10'); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Read-only response decision evidence', () => {
  it('loads an exact plan without requiring it in the current list and distinguishes policy, approval and execution evidence', async () => {
    await load(); expect(get).toHaveBeenCalledWith('/response-plans/7/decision-evidence', { params: { page: 1, size: 10 } });
    expect(screen.getByText(/Recorded priority: 0 · Policy approval flag: Not approved flag/)).toBeTruthy();
    expect(screen.getByText('Execution status: failed')).toBeTruthy(); expect(screen.getByText('Execution status: Not recorded')).toBeTruthy();
    expect(screen.getByText('Request #12 · rejected')).toBeTruthy(); expect(screen.getByText(/mutable records, not an immutable decision log/)).toBeTruthy();
    expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '7.2', '9007199254740993', 'wrong'])('rejects unsafe plan ID %s', value => {
    render(<ResponseDecisionEvidence />); fireEvent.change(screen.getByLabelText('Decision evidence plan ID'), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: 'Load decision evidence' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a positive plan record ID.'); expect(get).not.toHaveBeenCalled();
  });
  it('invalidates pending evidence when the ID draft changes', async () => {
    let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ResponseDecisionEvidence />); fireEvent.change(screen.getByLabelText('Decision evidence plan ID'), { target: { value: '7' } }); fireEvent.click(screen.getByRole('button', { name: 'Load decision evidence' }));
    fireEvent.change(screen.getByLabelText('Decision evidence plan ID'), { target: { value: '8' } }); await act(async () => finish({ data: snapshot }));
    expect(screen.queryByText('Plan #7 · Case #10')).toBeNull(); expect(screen.queryByRole('button', { name: 'Download loaded decision evidence JSON' })).toBeNull();
  });
  it('rejects a mismatched plan or approval-row association', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, approval_records: [{ ...snapshot.approval_records[0], plan_id: 99 }] } }); render(<ResponseDecisionEvidence />);
    fireEvent.change(screen.getByLabelText('Decision evidence plan ID'), { target: { value: '7' } }); fireEvent.click(screen.getByRole('button', { name: 'Load decision evidence' })); await screen.findByText(/did not match this plan and page/); expect(screen.queryByText('Plan #7 · Case #10')).toBeNull();
  });
  it('shows inaccessible evidence as an error and retries instead of claiming there are no decisions', async () => {
    get.mockRejectedValueOnce(new Error('Unavailable')); render(<ResponseDecisionEvidence />); fireEvent.change(screen.getByLabelText('Decision evidence plan ID'), { target: { value: '7' } }); fireEvent.click(screen.getByRole('button', { name: 'Load decision evidence' }));
    await screen.findByRole('alert'); expect(screen.queryByText(/No approval-request rows are recorded/)).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Retry decision evidence' })); await screen.findByText('Plan #7 · Case #10');
  });
  it('paginates saved requests server-side and the complete loaded action list locally', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, approval_total: 11, plan: { ...snapshot.plan, actions: Array.from({ length: 11 }, (_, index) => ({ action_type: `Action ${index + 1}` })) } } }); await load();
    fireEvent.click(screen.getByRole('button', { name: 'More recorded actions' })); expect(screen.getByText('Action position 11: Action 11')).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValueOnce({ data: { ...snapshot, approval_page: 2, approval_total: 11, approval_records: [{ ...snapshot.approval_records[0], id: 1 }] } }); fireEvent.click(screen.getByRole('button', { name: 'More approval requests' })); await screen.findByText('Request #1 · rejected'); expect(get.mock.calls.at(-1)?.[1]).toEqual({ params: { page: 2, size: 10 } });
  });
  it('exports only the loaded approval page and excludes actor identities unless opted in', async () => {
    let saved: Blob | undefined; vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { saved = blob; return 'blob:evidence'; }), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const read = () => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(saved!); });
    await load(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded decision evidence JSON' })); let body = JSON.parse(await read());
    expect(body.actor_identities_included).toBe(false); expect(body.plan).not.toHaveProperty('created_by'); expect(body.plan).not.toHaveProperty('approved_by'); expect(body.approval_records[0]).not.toHaveProperty('requested_by'); expect(body.approval_records[0]).not.toHaveProperty('reviewed_by');
    expect(body.plan.actions).toHaveLength(2); expect(body.approval_page).toBe(1); expect(body.plan.actions[0].execution_result.executed_at).toBe('2026-11-20T18:00:00+05:30');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include recorded actor identities and reviewer IDs in JSON' })); fireEvent.click(screen.getByRole('button', { name: 'Download loaded decision evidence JSON' })); body = JSON.parse(await read()); expect(body.plan.approved_by).toBe(55); expect(body.approval_records[0].requested_by).toBe('Request actor');
  });
});

it('opens only the exact linked plan automatically and exposes owner-scoped handoff links', async () => {
  render(<ResponseDecisionEvidence linkedPlanId="7" />);
  await screen.findByText('Plan #7 · Case #10');
  expect(get).toHaveBeenCalledWith('/response-plans/7/decision-evidence', { params: { page: 1, size: 10 } });
  expect(screen.getByRole('link', { name: 'Open exact plan evidence link' }).getAttribute('href')).toBe('/app/response-plans?plan=7');
  expect(screen.getByRole('link', { name: 'Open investigation #10' }).getAttribute('href')).toBe('/app/cases/10');
  expect(apiClient.post).not.toHaveBeenCalled();
});
it.each(['0', '7.0', '7e0', '-7', '', '9007199254740993', 'invalid'])('does not fetch malformed linked plan %j', linkedPlanId => {
  render(<ResponseDecisionEvidence linkedPlanId={linkedPlanId} />);
  expect(screen.getByRole('alert').textContent).toContain('invalid plan ID');
  expect(get).not.toHaveBeenCalled();
});
it('discards an older linked request and actor opt-in when URL plan changes', async () => {
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ResponseDecisionEvidence linkedPlanId="7" />);
  get.mockResolvedValueOnce({ data: { ...snapshot, plan: { ...snapshot.plan, id: 8 }, approval_records: [] } });
  view.rerender(<ResponseDecisionEvidence linkedPlanId="8" />);
  await screen.findByText('Plan #8 · Case #10');
  await act(async () => finish({ data: snapshot }));
  expect(screen.queryByText('Plan #7 · Case #10')).toBeNull();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  view.rerender(<ResponseDecisionEvidence linkedPlanId={null} />);
  expect(screen.queryByText('Plan #8 · Case #10')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download loaded decision evidence JSON' })).toBeNull();
});
it('copies only the exact plan link without actor selection or other query state', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await load(); fireEvent.click(screen.getByRole('button', { name: 'Copy exact plan evidence link' }));
  await screen.findByText(/Exact plan evidence link copied/);
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/response-plans?plan=7`);
});
it('keeps a usable link when clipboard permission is denied', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
  await load(); fireEvent.click(screen.getByRole('button', { name: 'Copy exact plan evidence link' }));
  await screen.findByText(/Copy unavailable/); expect(screen.getByRole('link', { name: 'Open exact plan evidence link' })).toBeTruthy();
});
