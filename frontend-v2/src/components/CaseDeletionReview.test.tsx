import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseDeletionReview } from './CaseDeletionReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), remove = vi.mocked(apiClient.delete), onClose = vi.fn(), onDeleted = vi.fn();
const account = { id: 5, email: 'owner@example.com', is_active: true, role: 'analyst', org_id: 7 };
const preview = () => ({ case: { id: 7, user_id: 5, title: 'Exact investigation', summary: 'Saved summary', status: 'open', severity: 'high' }, inventory: { tasks: [{ id: 1, case_id: 7, title: 'Collect memory', done: false }], watchers: [], alert_links: [], event_links: [], timeline: [], response_plans: [], approvals: [] }, reviewed_fingerprint: 'a'.repeat(64) });
function mount() { return render(<CaseDeletionReview caseId={7} onClose={onClose} onDeleted={onDeleted} />); }
async function confirm() { await screen.findByLabelText('Confirm investigation ID'); fireEvent.change(screen.getByLabelText('Confirm investigation ID'), { target: { value: '7' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Permanently remove reviewed investigation' })); }
beforeEach(() => { vi.clearAllMocks(); get.mockImplementation(async url => ({ data: url === '/auth/me' ? account : preview() })); remove.mockResolvedValue({ status: 204, data: null }); });
afterEach(cleanup);
describe('Exact permanent investigation removal', () => {
  it('shows full records and effects, requires exact typed ID plus acknowledgement, sends one guarded delete', async () => {
    mount(); await screen.findByText('tasks: 1'); expect(screen.getByText(/Original alerts and security events remain/)).toBeTruthy(); expect(screen.getByText('Collect memory')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Permanently remove reviewed investigation' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Confirm investigation ID'), { target: { value: '07' } }); fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByRole('button', { name: 'Permanently remove reviewed investigation' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Confirm investigation ID'), { target: { value: '7' } }); fireEvent.click(screen.getByRole('button', { name: 'Permanently remove reviewed investigation' })); await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce()); expect(remove).toHaveBeenCalledExactlyOnceWith('/cases/7', { params: { reviewed_fingerprint: 'a'.repeat(64) } });
  });
  it('cancels without mutation', async () => { mount(); await screen.findByText('tasks: 1'); fireEvent.click(screen.getByRole('button', { name: 'Close removal review' })); expect(onClose).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled(); });
  it.each([undefined, {}, { ...preview(), case: { ...preview().case, id: 8 } }, { ...preview(), case: { ...preview().case, user_id: 8 } }, { ...preview(), inventory: {} }, { ...preview(), reviewed_fingerprint: 'bad' }, { ...preview(), inventory: { ...preview().inventory, tasks: [{ id: 1 }, { id: 1 }] } }])('fails closed on incomplete or mismatched inventory %#', async value => {
    get.mockImplementation(async url => ({ data: url === '/auth/me' ? account : value })); mount(); await screen.findByRole('alert'); expect(screen.queryByLabelText('Confirm investigation ID')).toBeNull(); expect(remove).not.toHaveBeenCalled();
  });
  it('requires a fresh account before deletion', async () => { mount(); await screen.findByText('tasks: 1'); get.mockResolvedValue({ data: { ...account, email: 'changed@example.com' } }); await confirm(); await screen.findByText(/Current account changed/); expect(remove).not.toHaveBeenCalled(); });
  it.each([409, 500, 200])('never retries an uncertain or wrong-status result %s', async status => { if (status === 200) remove.mockResolvedValue({ status, data: {} }); else remove.mockRejectedValue({ response: { status }, message: 'PRIVATE' }); mount(); await confirm(); await screen.findByText(/Removal was not confirmed/); expect(remove).toHaveBeenCalledOnce(); expect(onDeleted).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Permanently remove reviewed investigation' })).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE'); });
  it('ignores late preview after unmount', async () => { let resolve!: (value: unknown) => void; get.mockImplementation(() => new Promise(done => { resolve = done; })); const view = mount(); view.unmount(); resolve({ data: preview() }); expect(remove).not.toHaveBeenCalled(); });
});
