import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponseDraftApproval } from './ResponseDraftApproval';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), changed = vi.fn();
const review = { plan: { id: 81, case_id: 7, status: 'draft', actions: [{ action_type: 'notify', target: 'soc', reason: 'Review evidence' }] }, review_fingerprint: 'a'.repeat(64) };
const view = () => render(<ResponseDraftApproval planId={81} onApproved={changed} />);
const load = () => fireEvent.click(screen.getByRole('button', { name: 'Load fresh draft approval review' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: review }); post.mockResolvedValue({ data: { success: true, plan_status: 'approved' } }); });
afterEach(cleanup);
it('loads fresh exact evidence and requires acknowledgement before fingerprint-bound approval without execution', async () => {
  view(); expect(get).not.toHaveBeenCalled(); load(); await screen.findByText('Target: soc'); expect(get).toHaveBeenCalledExactlyOnceWith('/response-plans/81/approval-review');
  const approve = screen.getByRole('button', { name: 'Approve reviewed plan #81' }); expect(approve.hasAttribute('disabled')).toBe(true); fireEvent.click(approve); expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(approve); await screen.findByText(/Approval recorded for plan #81/);
  expect(post).toHaveBeenCalledExactlyOnceWith('/response-plans/81/approve', { reviewed_fingerprint: 'a'.repeat(64) }); expect(changed).toHaveBeenCalledOnce();
});
it.each([{ plan: { ...review.plan, id: 9 } }, { review_fingerprint: 'bad' }, { plan: { ...review.plan, actions: [] } }, { plan: { ...review.plan, actions: [{ action_type: 'notify' }] } }, { plan: { ...review.plan, actions: [{ ...review.plan.actions[0], execution_result: {} }] } }])('rejects wrong or malformed review %j', async changes => {
  get.mockResolvedValueOnce({ data: { ...review, ...changes } }); view(); load(); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('does not offer draft approval for an already changed state', async () => {
  get.mockResolvedValueOnce({ data: { ...review, plan: { ...review.plan, status: 'approved' } } }); view(); load(); await screen.findByText(/not draft/); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('requires a fresh read and new acknowledgement after any failed or conflicting approval', async () => {
  post.mockRejectedValueOnce(new Error('Plan changed')); view(); load(); await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Approve reviewed plan #81' })); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull();
  load(); await screen.findByRole('checkbox'); expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false); expect(post).toHaveBeenCalledOnce();
});
it('ignores a prior plan review reply when the exact linked plan changes', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const rendered = view(); load(); rendered.rerender(<ResponseDraftApproval planId={82} onApproved={changed} />); await act(async () => finish({ data: review })); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
