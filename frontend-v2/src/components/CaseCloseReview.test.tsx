import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseCloseReview } from './CaseCloseReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get), patch = vi.mocked(apiClient.patch), close = vi.fn(), saved = vi.fn();
const preview = { case_id: 7, title: 'Gateway investigation', status: 'open', target_status: 'resolved', resolution: 'Recorded outcome', can_edit_resolution: true, open_tasks: [{ id: 209, title: 'Collect remaining evidence', done: false, assignee_id: 2, due_date: null }], task_total: 2, remaining_alerts: [{ id: 11, title: 'Active linked alert', status: 'pending', severity: 'high' }], alert_total: 3, unavailable_alert_links: 0, reviewed_fingerprint: 'a'.repeat(64) };
const acknowledgement = { success: true, data: { case_id: 7, status: 'resolved', resolution: 'Recorded outcome', reviewed_fingerprint: preview.reviewed_fingerprint, closed_at: '2026-11-21T00:00:00Z' } };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: preview }); patch.mockResolvedValue({ data: acknowledgement }); });
afterEach(cleanup);
function show() { return render(<CaseCloseReview caseId={7} targetStatus="resolved" label="Resolve" onClose={close} onSaved={saved} />); }
async function ready() { await screen.findByText('Investigation #7: Gateway investigation'); }
function confirm() { fireEvent.click(screen.getByRole('button', { name: 'Resolve' })); }
it('loads exact current remaining work and requires acknowledgement before closing only the case', async () => {
  show(); await ready(); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/closeout-review', { params: { target_status: 'resolved' } }); expect(patch).not.toHaveBeenCalled();
  expect(screen.getByText(/1 open of 2 checklist tasks/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByText('Review 1 remaining checklist task')); expect(screen.getByText(/Task #209: Collect remaining evidence/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox')); confirm(); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1)); expect(patch).toHaveBeenCalledExactlyOnceWith('/cases/7', null, { params: { status_update: 'resolved', reviewed_fingerprint: preview.reviewed_fingerprint, resolution: 'Recorded outcome' } });
});
it('does not require a remaining-work checkbox when the reviewed counts are all zero', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, open_tasks: [], remaining_alerts: [] } }); show(); await ready(); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', false); confirm(); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
});
it('makes unknown alert disposition explicit and requires acknowledgement even without visible remaining records', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, open_tasks: [], remaining_alerts: [], unavailable_alert_links: 1 } }); show(); await ready(); expect(screen.getByText(/Their disposition is unknown/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', true);
});
it('lets the owner deliberately replace or clear the resolution and verifies the exact saved value', async () => {
  patch.mockResolvedValueOnce({ data: { ...acknowledgement, data: { ...acknowledgement.data, resolution: null } } }); show(); await ready(); fireEvent.change(screen.getByLabelText(/Resolution summary/), { target: { value: '  ' } }); fireEvent.click(screen.getByRole('checkbox')); confirm(); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1)); expect(patch).toHaveBeenCalledWith('/cases/7', null, { params: expect.objectContaining({ resolution: '' }) });
});
it('keeps assignee close-out status-only and preserves the owner resolution', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, can_edit_resolution: false } }); show(); await ready(); expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.getByText(/Only the owner can edit the resolution/)).toBeTruthy(); fireEvent.click(screen.getByRole('checkbox')); confirm(); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1)); expect(patch).toHaveBeenCalledExactlyOnceWith('/cases/7', null, { params: { status_update: 'resolved', reviewed_fingerprint: preview.reviewed_fingerprint } });
});
it.each([null, {}, { ...preview, case_id: 8 }, { ...preview, target_status: 'closed' }, { ...preview, status: 'resolved' }, { ...preview, task_total: 0 }, { ...preview, open_tasks: [{ ...preview.open_tasks[0], done: true }] }, { ...preview, remaining_alerts: [{ ...preview.remaining_alerts[0], status: 'resolved' }] }, { ...preview, open_tasks: [preview.open_tasks[0], preview.open_tasks[0]] }])('rejects malformed or mismatched close-out evidence', async value => {
  get.mockResolvedValueOnce({ data: value }); show(); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', true); expect(patch).not.toHaveBeenCalled();
});
it.each([{}, { success: true }, { ...acknowledgement, data: { ...acknowledgement.data, case_id: 8 } }, { ...acknowledgement, data: { ...acknowledgement.data, status: 'closed' } }, { ...acknowledgement, data: { ...acknowledgement.data, resolution: 'Different outcome' } }, { ...acknowledgement, data: { ...acknowledgement.data, reviewed_fingerprint: 'b'.repeat(64) } }])('does not confirm or retry an ambiguous close-out acknowledgement', async value => {
  patch.mockResolvedValueOnce({ data: value }); show(); await ready(); fireEvent.click(screen.getByRole('checkbox')); confirm(); await screen.findByRole('alert'); expect(saved).not.toHaveBeenCalled(); expect(patch).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', true);
});
it('refreshes after a stale-review rejection and replaces the old resolution draft and acknowledgement', async () => {
  patch.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { detail: 'Remaining work changed' } } }); show(); await ready(); fireEvent.change(screen.getByLabelText(/Resolution summary/), { target: { value: 'Draft outcome' } }); fireEvent.click(screen.getByRole('checkbox')); confirm(); await screen.findByRole('alert'); get.mockResolvedValueOnce({ data: { ...preview, resolution: 'New saved outcome', reviewed_fingerprint: 'b'.repeat(64) } }); fireEvent.click(screen.getByRole('button', { name: 'Refresh close-out review' })); await ready(); expect(screen.getByLabelText(/Resolution summary/)).toHaveProperty('value', 'New saved outcome'); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); expect(patch).toHaveBeenCalledTimes(1);
});
it('blocks duplicate submission, Escape, cancel and refresh while the reviewed save is pending', async () => {
  let finish!: (value: unknown) => void; patch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); show(); await ready(); fireEvent.click(screen.getByRole('checkbox')); confirm(); fireEvent.click(screen.getByRole('button', { name: 'Saving reviewed close-out...' })); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true); expect(screen.getByRole('button', { name: 'Refresh close-out review' })).toHaveProperty('disabled', true); await act(async () => finish({ data: acknowledgement })); expect(patch).toHaveBeenCalledTimes(1); expect(saved).toHaveBeenCalledTimes(1);
});
it('ignores a late save after leaving the case', async () => {
  let finish!: (value: unknown) => void; patch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); await ready(); fireEvent.click(screen.getByRole('checkbox')); confirm(); view.unmount(); await act(async () => finish({ data: acknowledgement })); expect(saved).not.toHaveBeenCalled();
});
