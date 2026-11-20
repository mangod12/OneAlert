import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AlertInvestigationDialog } from './AlertInvestigationDialog';
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const preview = { alert: { id: 99, created_at: '2026-11-01T00:00:00Z', title: 'Saved gateway finding', description: null, severity: 'high', status: 'pending', cve_id: null, asset_id: 12 }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 1, existing_cases: [{ id: 12, title: 'Existing saved inquiry', status: 'closed' }], due_dates: { info: null, low: null, medium: null, high: '2026-11-24', critical: null } };
const result = { id: 7, alert_id: 99, linked: true, reviewed_fingerprint: preview.reviewed_fingerprint };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: preview }); post.mockResolvedValue({ data: result }); }); afterEach(cleanup);
function setup() { const close = vi.fn(); render(<AlertInvestigationDialog alertId={99} onCancel={close} />); return close; }
async function acknowledge() { await screen.findByLabelText('Title'); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this saved alert/ })); }
it('reviews exact alert, existing owned cases and SLA due date without writes before consent', async () => {
  setup(); await screen.findByText('Saved gateway finding · Alert #99'); expect(get).toHaveBeenCalledExactlyOnceWith('/alerts/99/investigation-preview'); expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Case #12: Existing saved inquiry' }).getAttribute('href')).toBe('/app/cases/12'); expect(screen.getByRole('link', { name: 'Open exact saved alert evidence' }).getAttribute('href')).toBe('/app/alerts?alert=99'); expect(screen.getByText(/CVE: Not recorded/)).toBeTruthy(); expect(screen.getByText(/SLA due date: 2026-11-24/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create reviewed investigation' })).toHaveProperty('disabled', true);
});
it('clears acknowledgement after edits and atomically creates/links once with exact response navigation', async () => {
  setup(); await acknowledge(); fireEvent.change(screen.getByLabelText('Summary'), { target: { value: ' Reviewed context ' } }); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed investigation' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/cases/7')); expect(post).toHaveBeenCalledExactlyOnceWith('/alerts/99/investigations', { title: 'Investigate: Saved gateway finding', summary: 'Reviewed context', severity: 'high', reviewed_fingerprint: preview.reviewed_fingerprint });
});
it('blocks duplicate submits and closing through Cancel or Escape while creation is in flight', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const close = setup(); await acknowledge(); const form = screen.getByRole('button', { name: 'Create reviewed investigation' }).closest('form')!; fireEvent.submit(form); fireEvent.submit(form); fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(post).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled(); await act(async () => finish({ data: result })); expect(navigate).toHaveBeenCalledWith('/cases/7');
});
it.each([{ ...result, alert_id: 98 }, { ...result, linked: false }, { ...result, id: 0 }, { ...result, reviewed_fingerprint: 'c'.repeat(64) }])('blocks retry on an unconfirmed response until refreshed and newly acknowledged %#', async data => {
  post.mockResolvedValueOnce({ data }); setup(); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed investigation' })); await screen.findByRole('alert'); expect(navigate).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Create reviewed investigation' })).toHaveProperty('disabled', true); expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh investigation preview' })); await screen.findByLabelText('Title'); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); expect(post).toHaveBeenCalledTimes(1);
});
it('keeps draft text, requires a new review after network failure and does not infer no existing cases', async () => {
  post.mockRejectedValueOnce(new Error('connection lost')); setup(); await screen.findByLabelText('Title'); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My saved case title' } }); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed investigation' })); await screen.findByRole('alert'); expect(screen.getByText(/No automatic retry was made/)).toBeTruthy();
  get.mockResolvedValueOnce({ data: { ...preview, existing_case_count: 2, existing_cases: [...preview.existing_cases, { id: 7, title: 'My saved case title', status: 'open' }] } }); fireEvent.click(screen.getByRole('button', { name: 'Refresh investigation preview' })); await screen.findByRole('link', { name: 'Case #7: My saved case title' }); expect(screen.getByLabelText('Title')).toHaveProperty('value', 'My saved case title'); expect(post).toHaveBeenCalledTimes(1);
});
it.each([{ ...preview, alert: { ...preview.alert, id: 98 } }, { ...preview, reviewed_fingerprint: 'bad' }, { ...preview, existing_case_count: 0 }, { ...preview, existing_cases: [{ id: -1, title: 'Wrong', status: 'open' }] }, { ...preview, due_dates: {} }])('rejects invalid preview without enabling creation %#', async data => {
  get.mockResolvedValueOnce({ data }); const close = setup(); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(close).toHaveBeenCalledOnce();
});
it('does not redirect from an unmounted dialog when a pending create returns', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<AlertInvestigationDialog alertId={99} onCancel={vi.fn()} />); await acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed investigation' })); view.unmount(); await act(async () => finish({ data: result })); expect(navigate).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid exact alert ID %s without reading', async alertId => {
  render(<AlertInvestigationDialog alertId={alertId} onCancel={vi.fn()} />); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
