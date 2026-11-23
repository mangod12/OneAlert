import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Watchlist } from './Watchlist';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), remove = vi.mocked(apiClient.delete);
const account = { id: 5, email: 'analyst@example.test', role: 'analyst', org_id: 7, is_active: true };
const alert = { id: 3, title: 'Edge alert', cve_id: 'CVE-2026-0001', asset_name: 'edge-router', severity: 'high', status: 'pending', created_at: '2026-11-20T00:00:00Z' };
const investigation = { id: 3, title: 'Edge investigation', severity: 'critical', status: 'open', created_at: '2026-11-20T00:00:00Z', due_date: '2026-12-01' };
let mode = '', secondAlert = false;
function source(url: string) {
  if (url === '/auth/me') return { data: mode === 'account' ? { ...account, id: 6 } : mode === 'identity' ? {} : account };
  if (url === '/alerts/') return { data: { alerts: [alert, ...(secondAlert ? [{ ...alert, id: 4, title: 'Later alert' }] : [])], total: 51 } };
  if (url === '/cases/') return { data: { cases: [investigation], total: 1 } };
  if (url.endsWith('/watchers')) return { data: mode === 'membership' ? [{ user_id: 9 }] : [{ user_id: 5 }, { user_id: 9 }] };
  if (url === '/alerts/3') return { data: mode === 'title' ? { ...alert, title: 'Changed' } : alert };
  if (url === '/alerts/4') return { data: { ...alert, id: 4, title: 'Later alert' } };
  if (url === '/cases/3') return { data: mode === 'date' ? { ...investigation, due_date: null } : investigation };
  return { data: [] };
}
beforeEach(() => { vi.resetAllMocks(); mode = ''; secondAlert = false; get.mockImplementation(async url => source(url)); remove.mockResolvedValue({ status: 200, data: { success: true, watching: false } }); });
afterEach(cleanup);
const mount = () => render(<MemoryRouter><Watchlist /></MemoryRouter>);
const confirm = (n = 1) => screen.getByRole('button', { name: `Confirm ${n} reviewed removals` });
async function reviewAlert() { fireEvent.click(await screen.findByRole('button', { name: 'Unwatch CVE-2026-0001 - Edge alert' })); await screen.findByRole('dialog'); }
it('reviews exact account, identity and loss-of-access limits before one verified self-only delete', async () => {
  mount(); await reviewAlert(); expect(remove).not.toHaveBeenCalled(); const text = screen.getByRole('dialog').textContent!; for (const value of ['Alert #3', 'Edge alert', 'Current account #5', 'analyst@example.test', 'may lose access', 'not a server lock or conditional delete', 'Other watchers stay subscribed']) expect(text).toContain(value);
  fireEvent.click(confirm()); await screen.findByText(/Verified 1 of 1/); expect(remove).toHaveBeenCalledExactlyOnceWith('/alerts/3/watch'); expect(get).toHaveBeenCalledWith('/alerts/3'); expect(get).toHaveBeenCalledWith('/alerts/3/watchers'); expect(screen.queryByRole('link', { name: 'CVE-2026-0001 - Edge alert' })).toBeNull(); expect(screen.getByRole('link', { name: 'Edge investigation' })).toBeTruthy();
});
it('cancels without writes and keeps selection', async () => { mount(); fireEvent.click(await screen.findByRole('button', { name: 'Select matching watched items' })); fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' })); await screen.findByRole('dialog'); fireEvent.click(screen.getByRole('button', { name: 'Cancel watch review' })); expect(remove).not.toHaveBeenCalled(); expect(screen.getByText(/2 loaded records selected/)).toBeTruthy(); });
it('freezes mixed types with overlapping IDs and hidden selections', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Select matching watched items' })); fireEvent.change(screen.getByLabelText('Watched item type'), { target: { value: 'alert' } }); fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' })); await screen.findByRole('dialog'); expect(screen.getByRole('dialog').textContent).toContain('including 1 hidden'); expect(screen.getByRole('dialog').textContent).toContain('Investigation #3'); expect(screen.getByLabelText('Watched item type')).toHaveProperty('disabled', true); fireEvent.click(confirm(2)); await screen.findByText(/Verified 2 of 2/); expect(remove.mock.calls.map(([url]) => url)).toEqual(['/cases/3/watch', '/alerts/3/watch']);
});
it.each(['account', 'title', 'membership', 'date'])('rejects changed preflight %s before sending any removal', async value => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Select matching watched items' })); fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' })); await screen.findByRole('dialog'); mode = value; fireEvent.click(confirm(2)); await screen.findByText(/No unwatch mutation was sent/); expect(remove).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Review selected unwatch' })).toHaveProperty('disabled', true); expect(screen.getByText(/2 loaded records selected/)).toBeTruthy();
});
it('stops sequential removals at the first unknown, keeps failed and unsent selections and requires reload', async () => {
  secondAlert = true; remove.mockResolvedValueOnce({ status: 200, data: { success: true, watching: false } }).mockRejectedValueOnce(Error('PRIVATE')); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Select matching watched items' })); fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' })); await screen.findByRole('dialog'); fireEvent.click(confirm(3)); await screen.findByText(/Verified 1 of 3/); expect(remove.mock.calls.map(([url]) => url)).toEqual(['/cases/3/watch', '/alerts/3/watch']); expect(screen.getByText(/2 loaded records selected/)).toBeTruthy(); expect(screen.getByText(/later records were not sent/)).toBeTruthy(); expect(document.body.textContent).not.toContain('PRIVATE'); expect(screen.getByRole('button', { name: 'Review selected unwatch' })).toHaveProperty('disabled', true); expect(screen.getByRole('button', { name: 'Load more watched items' })).toHaveProperty('disabled', true); fireEvent.click(screen.getByRole('button', { name: 'Reload watched items from first page' })); await waitFor(() => expect(screen.queryByText(/Verified 1 of 3/)).toBeNull()); expect(remove).toHaveBeenCalledTimes(2); expect(screen.getByText(/0 loaded records selected/)).toBeTruthy();
});
it.each([{ status: 204, data: {} }, { status: 200, data: {} }, { status: 200, data: { success: true, watching: true } }, { status: 200, data: { success: false, watching: false } }])('does not optimistically remove unconfirmed responses', async response => { remove.mockResolvedValue(response); mount(); await reviewAlert(); fireEvent.click(confirm()); await screen.findByText(/Verified 0 of 1/); expect(screen.getByRole('link', { name: 'CVE-2026-0001 - Edge alert' })).toBeTruthy(); expect(remove).toHaveBeenCalledOnce(); });
it('blocks unverifiable identity without a mutation or leaking response content', async () => { mode = 'identity'; mount(); fireEvent.click(await screen.findByRole('button', { name: 'Unwatch CVE-2026-0001 - Edge alert' })); await screen.findByText(/current account could not be verified/); expect(screen.queryByRole('dialog')).toBeNull(); expect(remove).not.toHaveBeenCalled(); });
it('guards duplicate confirmation and ignores late preflight after unmount', async () => { const view = mount(); await reviewAlert(); let finish!: (value: unknown) => void; get.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const button = confirm(); fireEvent.click(button); fireEvent.click(button); view.unmount(); await act(async () => finish({ data: account })); expect(remove).not.toHaveBeenCalled(); });
