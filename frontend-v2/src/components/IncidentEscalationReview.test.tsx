import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { IncidentEscalationReview } from './IncidentEscalationReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), close = vi.fn(), created = vi.fn();
const alert = { id: 11, title: 'Recorded active evidence', severity: 'high', status: 'pending', cve_id: null, created_at: null };
const proposal = { asset_id: 5, asset_name: 'Gateway', title: 'Incident on Gateway', summary: 'Review recorded evidence', severity: 'high', status: 'open', due_date: '2026-11-23', reviewed_fingerprint: 'a'.repeat(64), alerts: [alert], existing_cases: [] };
const saved = { id: 44, asset_id: 5, title: proposal.title, severity: 'high', alerts_linked: 1, alert_ids: [11], reviewed_fingerprint: proposal.reviewed_fingerprint };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: proposal }); post.mockResolvedValue({ data: saved }); });
afterEach(cleanup);
function show() { return render(<MemoryRouter><IncidentEscalationReview assetId={5} onClose={close} onCreated={created} /></MemoryRouter>); }
async function loaded() { await screen.findByText('Asset #5: Gateway'); }
function create() { fireEvent.click(screen.getByRole('button', { name: 'Create reviewed investigation' })); }
it('previews exact evidence and proposal before sending one fingerprint-guarded creation', async () => {
  show(); await loaded(); expect(post).not.toHaveBeenCalled(); expect(screen.getByText(/All 1 active alert records/)).toBeTruthy(); expect(screen.getByText('open · high · 2026-11-23')).toBeTruthy();
  create(); await waitFor(() => expect(created).toHaveBeenCalledWith(44)); expect(post).toHaveBeenCalledExactlyOnceWith('/incidents/5/escalate', { reviewed_fingerprint: proposal.reviewed_fingerprint });
});
it('requires explicit new-case acknowledgement when existing investigations overlap reviewed evidence', async () => {
  get.mockResolvedValueOnce({ data: { ...proposal, existing_cases: [{ id: 8, title: 'Existing gateway investigation', status: 'closed' }] } }); show(); await loaded();
  expect(screen.getByRole('button', { name: 'Create reviewed investigation' })).toHaveProperty('disabled', true); expect(screen.getByRole('link').getAttribute('href')).toBe('/cases/8');
  fireEvent.click(screen.getByRole('checkbox')); create(); await waitFor(() => expect(created).toHaveBeenCalledWith(44));
});
it('shows all evidence across review pages without implying page-only linking', async () => {
  const alerts = Array.from({ length: 45 }, (_, i) => ({ ...alert, id: i + 1, title: `Evidence ${i + 1}` })); get.mockResolvedValueOnce({ data: { ...proposal, alerts } }); show(); await loaded(); expect(screen.getAllByRole('listitem')).toHaveLength(20); expect(screen.getByText(/All 45 active alert records/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next review page' })); expect(screen.getByText('Alert #21: Evidence 21')).toBeTruthy(); expect(screen.getByText('Review page 2 of 3')).toBeTruthy(); expect(post).not.toHaveBeenCalled();
});
it.each([null, {}, { ...proposal, asset_id: 6 }, { ...proposal, alerts: [] }, { ...proposal, alerts: [{ ...alert, status: 'resolved' }] }, { ...proposal, alerts: [alert, alert] }, { ...proposal, reviewed_fingerprint: 'bad' }, { ...proposal, existing_cases: [{ id: -1 }] }])('rejects an unusable or mismatched preview without enabling creation', async value => {
  get.mockResolvedValueOnce({ data: value }); show(); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Create reviewed investigation' })).toHaveProperty('disabled', true); expect(post).not.toHaveBeenCalled();
});
it.each([{}, { ...saved, id: 0 }, { ...saved, asset_id: 6 }, { ...saved, reviewed_fingerprint: 'b'.repeat(64) }, { ...saved, alert_ids: [12] }, { ...saved, alerts_linked: 2 }, { ...saved, title: 'Other investigation' }])('never navigates or retries after an ambiguous creation acknowledgement', async value => {
  post.mockResolvedValueOnce({ data: value }); show(); await loaded(); create(); await screen.findByRole('alert'); expect(created).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Create reviewed investigation' })).toHaveProperty('disabled', true); expect(post).toHaveBeenCalledTimes(1); expect(screen.getByText(/A previous request may already have created one/)).toBeTruthy();
});
it('refreshes a conflict into a new review and clears any old existing-case acknowledgement', async () => {
  const existing = [{ id: 8, title: 'Existing investigation', status: 'open' }]; get.mockResolvedValueOnce({ data: { ...proposal, existing_cases: existing } }); post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { detail: 'The incident evidence changed' } } });
  show(); await loaded(); fireEvent.click(screen.getByRole('checkbox')); create(); await screen.findByRole('alert');
  get.mockResolvedValueOnce({ data: { ...proposal, existing_cases: existing, reviewed_fingerprint: 'b'.repeat(64) } }); fireEvent.click(screen.getByRole('button', { name: 'Refresh escalation preview' })); await loaded(); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); expect(screen.getByRole('button', { name: 'Create reviewed investigation' })).toHaveProperty('disabled', true); expect(post).toHaveBeenCalledTimes(1);
});
it('blocks duplicate writes, Escape, cancellation and refresh during creation', async () => {
  let finish!: (value: unknown) => void; post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); show(); await loaded(); create(); fireEvent.click(screen.getByRole('button', { name: 'Creating reviewed investigation...' })); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true); expect(screen.getByRole('button', { name: 'Refresh escalation preview' })).toHaveProperty('disabled', true);
  await act(async () => finish({ data: saved })); expect(post).toHaveBeenCalledTimes(1); expect(created).toHaveBeenCalledWith(44);
});
it('ignores a creation result after unmount', async () => {
  let finish!: (value: unknown) => void; post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); await loaded(); create(); view.unmount(); await act(async () => finish({ data: saved })); expect(created).not.toHaveBeenCalled();
});
it('can retry failed preview reads without treating them as no active evidence', async () => {
  get.mockRejectedValueOnce(new Error('Service unavailable')); show(); await screen.findByRole('alert'); expect(screen.queryByRole('list')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Refresh escalation preview' })); await loaded(); expect(get).toHaveBeenCalledTimes(2); expect(post).not.toHaveBeenCalled();
});
