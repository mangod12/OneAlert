import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponsePlans } from './ResponsePlans';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const approval = { id: 100, plan_id: 100, case_id: 400, reason: 'Old 100%_literal review', requested_by: 'reviewer-a', plan_status: 'pending_approval', actions: [], autonomy_level: 'L3', created_at: '2026-01-01T00:00:00Z', review_fingerprint: 'a'.repeat(64) };
const response = (data: unknown[] = [approval], total = 219, page = 1) => ({ data, total, page, size: 10 });
const queueCalls = () => get.mock.calls.filter(([url]) => url.endsWith('pending-approvals'));
const latest = () => queueCalls().at(-1)?.[1]?.params as Record<string, unknown>;
const mount = () => render(<MemoryRouter><ResponsePlans /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (url, config) => ({ data: url.endsWith('pending-approvals') ? response([approval], 219, Number((config?.params as { page?: number })?.page ?? 1)) : { data: [], total: 0 } })); });
afterEach(cleanup);
it('applies trimmed reason/requester search and exact case only when submitted', async () => {
  mount(); await screen.findByText('Plan #100 — Case #400'); fireEvent.change(screen.getByLabelText('Search all pending approvals'), { target: { value: '  100%_literal  ' } });
  fireEvent.change(screen.getByLabelText('Approval investigation ID'), { target: { value: ' 400 ' } });
  expect(screen.getByText(/Queue search draft not applied/)).toBeTruthy(); expect(queueCalls()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Search approval queue' })); await waitFor(() => expect(latest()).toEqual({ page: 1, size: 10, query: '100%_literal', case_id: 400 }));
  expect(screen.getByText(/Requester: reviewer-a/)).toBeTruthy(); expect(screen.getByText(/Queue filters do not restrict the plan-wide effects/)).toBeTruthy(); expect(post).not.toHaveBeenCalled();
});
it('resets pages and closes a reviewed approval when global filters change', async () => {
  mount(); await screen.findByText('Plan #100 — Case #400'); fireEvent.click(screen.getByRole('button', { name: 'Next approval page' })); await waitFor(() => expect(latest().page).toBe(2));
  await screen.findByRole('button', { name: 'Review approval' }); fireEvent.click(screen.getByRole('button', { name: 'Review approval' })); await screen.findByRole('region', { name: 'Approval review for plan 100' });
  fireEvent.change(screen.getByLabelText('Approval autonomy level'), { target: { value: 'L3' } }); await waitFor(() => expect(latest()).toMatchObject({ page: 1, autonomy_level: 'L3' }));
  expect(screen.queryByRole('region', { name: 'Approval review for plan 100' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Approval request order'), { target: { value: 'oldest' } }); await waitFor(() => expect(latest()).toMatchObject({ page: 1, sort: 'oldest', autonomy_level: 'L3' }));
  expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20 } });
});
it.each(['0', '-4', '1.5', '9007199254740992', 'bad'])('does not apply invalid investigation draft %s', async value => {
  mount(); await screen.findByText('Plan #100 — Case #400'); fireEvent.change(screen.getByLabelText('Approval investigation ID'), { target: { value } });
  expect(screen.getByText(/Use one positive whole-number investigation ID/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Search approval queue' })); expect(queueCalls()).toHaveLength(1);
});
it('keeps the filters available when no pending requests match and clears back to defaults', async () => {
  mount(); await screen.findByText('Plan #100 — Case #400'); get.mockImplementation(async url => ({ data: url.endsWith('pending-approvals') ? response([], 0) : { data: [], total: 0 } }));
  fireEvent.change(screen.getByLabelText('Approval autonomy level'), { target: { value: 'L4' } }); await screen.findByText(/No pending approval requests match/);
  fireEvent.click(screen.getByRole('button', { name: 'Clear approval queue filters' })); await waitFor(() => expect(latest()).toEqual({ page: 1, size: 10 }));
});
it('ignores an older filtered queue response and never enables its approval review', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => Promise.resolve({ data: { data: [], total: 0 } })).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  mount(); fireEvent.change(screen.getByLabelText('Approval autonomy level'), { target: { value: 'L2' } }); await screen.findByText('Plan #100 — Case #400');
  await act(async () => { resolve({ data: response([{ ...approval, id: 22, plan_id: 22, reason: 'Stale request' }]) }); }); expect(screen.queryByText('Stale request')).toBeNull();
});
it('retries a failed queue read without dropping the applied global filters', async () => {
  mount(); await screen.findByText('Plan #100 — Case #400'); get.mockImplementation(async url => { if (url.endsWith('pending-approvals')) throw new Error('Queue unavailable'); return { data: { data: [], total: 0 } }; });
  fireEvent.change(screen.getByLabelText('Approval request order'), { target: { value: 'oldest' } }); await screen.findByText('Queue unavailable'); expect(screen.queryByRole('button', { name: 'Review approval' })).toBeNull();
  get.mockImplementation(async url => ({ data: url.endsWith('pending-approvals') ? response() : { data: [], total: 0 } })); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('Plan #100 — Case #400'); expect(latest().sort).toBe('oldest');
});
it('refreshes the applied queue without silently applying a different search draft', async () => {
  mount(); await screen.findByText('Plan #100 — Case #400'); fireEvent.change(screen.getByLabelText('Approval autonomy level'), { target: { value: 'L3' } }); await screen.findByText('Plan #100 — Case #400');
  fireEvent.change(screen.getByLabelText('Search all pending approvals'), { target: { value: 'unapplied draft' } }); const before = queueCalls().length;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh approval queue' })); await waitFor(() => expect(queueCalls()).toHaveLength(before + 1)); expect(latest()).toEqual({ page: 1, size: 10, autonomy_level: 'L3' }); expect(screen.getByText(/Queue search draft not applied/)).toBeTruthy();
});
