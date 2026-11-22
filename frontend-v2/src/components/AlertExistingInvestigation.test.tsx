import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AlertExistingInvestigation } from './AlertExistingInvestigation';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const preview = { alert: { id: 99, created_at: '2026-11-22T00:00:00Z', title: 'Saved gateway alert', description: 'Recorded finding', severity: 'high', status: 'pending', cve_id: null, asset_id: null }, case: { id: 12, title: 'Recorded investigation', summary: 'Owned saved summary', severity: 'medium', status: 'open', due_date: null, closed_at: null, assigned_to_id: null }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), already_linked: false, resulting_severity: 'high' };
const result = { case_id: 12, alert_id: 99, linked: true, created: true, severity: 'high', reviewed_fingerprint: preview.reviewed_fingerprint };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: preview }); post.mockResolvedValue({ data: result }); }); afterEach(cleanup);
const id = () => screen.getByLabelText('Existing investigation ID');
const review = () => screen.getByRole('button', { name: 'Review exact investigation link' });
const save = () => screen.getByRole('button', { name: 'Save reviewed investigation link' });
async function read() { fireEvent.change(id(), { target: { value: '12' } }); fireEvent.click(review()); await screen.findByRole('heading', { name: 'Investigation #12: Recorded investigation' }); }
async function acknowledge() { await read(); fireEvent.click(screen.getByRole('checkbox')); }
it('does not read or write automatically, then explicitly reviews exact alert and owned investigation', async () => {
  render(<AlertExistingInvestigation alertId={99} />); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); await read();
  expect(get).toHaveBeenCalledExactlyOnceWith('/alerts/99/existing-investigations/12/preview'); expect(post).not.toHaveBeenCalled(); expect(save()).toHaveProperty('disabled', true);
  expect(screen.getByText('Owned saved summary')).toBeTruthy(); expect(screen.getByText(/CVE not recorded/)).toBeTruthy(); expect(screen.getByText(/does not move or remove other links/)).toBeTruthy(); expect(screen.getByRole('link', { name: 'Open reviewed investigation #12' }).getAttribute('href')).toBe('/app/cases/12');
});
it('saves only the acknowledged fingerprint and validates the exact confirmation without creating a case', async () => {
  render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.click(save()); await screen.findByRole('link', { name: 'Open linked investigation #12' });
  expect(post).toHaveBeenCalledExactlyOnceWith('/alerts/99/existing-investigations/12', { reviewed_fingerprint: preview.reviewed_fingerprint }); expect(screen.getByText(/No new case was created/)).toBeTruthy(); expect(screen.queryByRole('checkbox')).toBeNull();
});
it('changing the exact ID clears preview and consent immediately without another read', async () => {
  render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.change(id(), { target: { value: '13' } }); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('Owned saved summary')).toBeNull(); expect(get).toHaveBeenCalledTimes(1); expect(post).not.toHaveBeenCalled();
});
it.each(['', '0', '-1', '1.5', '0012', '12x', '9007199254740992'])('rejects invalid exact case ID %s without a lookup', async value => {
  render(<AlertExistingInvestigation alertId={99} />); fireEvent.change(id(), { target: { value } }); fireEvent.click(review()); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid alert ID %s without a lookup', async alertId => {
  render(<AlertExistingInvestigation alertId={alertId} />); fireEvent.change(id(), { target: { value: '12' } }); fireEvent.click(review()); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it('shows closed investigation and preserved close-out warning before any explicit acknowledgement', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, case: { ...preview.case, status: 'closed', closed_at: '2026-11-21T00:00:00Z' } } }); render(<AlertExistingInvestigation alertId={99} />); await read(); expect(screen.getByText(/This investigation is closed/)).toBeTruthy(); expect(save()).toHaveProperty('disabled', true); expect(post).not.toHaveBeenCalled();
});
it('already-linked read requires no write and does not offer a save control', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, already_linked: true, resulting_severity: 'medium' } }); render(<AlertExistingInvestigation alertId={99} />); await read(); expect(screen.getByText(/This exact alert is already linked/)).toBeTruthy(); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it.each([{ ...preview, alert: { ...preview.alert, id: 98 } }, { ...preview, case: { ...preview.case, id: 13 } }, { ...preview, reviewed_fingerprint: 'bad' }, { ...preview, alert_fingerprint: 'bad' }, { ...preview, already_linked: 'false' }, { ...preview, case: { ...preview.case, summary: {} } }, { ...preview, case: { ...preview.case, status: 'unexpected' } }, { ...preview, alert: { ...preview.alert, created_at: 'bad' } }, { ...preview, case: { ...preview.case, assigned_to_id: -1 } }])('rejects mismatched or malformed preview %#', async data => {
  get.mockResolvedValueOnce({ data }); render(<AlertExistingInvestigation alertId={99} />); fireEvent.change(id(), { target: { value: '12' } }); fireEvent.click(review()); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('does not reflect private server errors or infer missing evidence, and an explicit new read recovers', async () => {
  get.mockRejectedValueOnce({ response: { data: { detail: 'PRIVATE_DATABASE_CONTENT' } } }); render(<AlertExistingInvestigation alertId={99} />); fireEvent.change(id(), { target: { value: '12' } }); fireEvent.click(review()); await screen.findByRole('alert'); expect(document.body.textContent).not.toContain('PRIVATE_DATABASE_CONTENT'); expect(screen.getByText(/No absence or link is inferred/)).toBeTruthy(); fireEvent.click(review()); await screen.findByRole('checkbox');
});
it('discards late reads after exact ID changes and does not save the previous proposal', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); render(<AlertExistingInvestigation alertId={99} />); fireEvent.change(id(), { target: { value: '12' } }); fireEvent.click(review()); fireEvent.change(id(), { target: { value: '13' } }); await act(async () => finish({ data: preview })); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('Owned saved summary')).toBeNull();
});
it('blocks duplicate mutation submits and ID edits while the outcome is pending', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.click(save()); fireEvent.click(screen.getByRole('button', { name: 'Saving reviewed link...' })); expect(id()).toHaveProperty('disabled', true); expect(review()).toHaveProperty('disabled', true); expect(post).toHaveBeenCalledTimes(1); await act(async () => finish({ data: result })); await screen.findByRole('link', { name: 'Open linked investigation #12' });
});
it.each([{ ...result, case_id: 13 }, { ...result, alert_id: 98 }, { ...result, linked: false }, { ...result, created: 'true' }, { ...result, reviewed_fingerprint: 'c'.repeat(64) }])('uncertain confirmation %# clears review and never retries automatically', async data => {
  post.mockResolvedValueOnce({ data }); render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.click(save()); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('link', { name: 'Open linked investigation #12' })).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
  get.mockResolvedValueOnce({ data: { ...preview, already_linked: true, resulting_severity: 'medium' } }); fireEvent.click(review()); await screen.findByText(/This exact alert is already linked/); expect(post).toHaveBeenCalledTimes(1);
});
it('network failure after submission requires checking the exact link before another decision', async () => {
  post.mockRejectedValueOnce(new Error('lost response')); render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.click(save()); await screen.findByRole('alert'); expect(screen.getByText(/No automatic retry was made/)).toBeTruthy(); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
it('refreshing the same ID clears acknowledgement even if the preview is unchanged', async () => {
  render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.click(review()); await waitFor(() => expect(get).toHaveBeenCalledTimes(2)); await screen.findByRole('checkbox'); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); expect(save()).toHaveProperty('disabled', true);
});
it('changing alert identity during a pending mutation resets the surface and ignores the old outcome', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.click(save()); view.rerender(<AlertExistingInvestigation alertId={98} />); expect(id()).toHaveProperty('value', ''); await act(async () => finish({ data: result })); expect(screen.queryByRole('link', { name: 'Open linked investigation #12' })).toBeNull(); expect(get).toHaveBeenCalledTimes(1);
});
it('invalidates previously loaded investigation links even when a mutation outcome is uncertain', async () => {
  const onLinkOutcome = vi.fn(); post.mockRejectedValueOnce(new Error('lost response')); render(<AlertExistingInvestigation alertId={99} onLinkOutcome={onLinkOutcome} />); await acknowledge(); expect(onLinkOutcome).not.toHaveBeenCalled(); fireEvent.click(save()); await screen.findByRole('alert'); expect(onLinkOutcome).toHaveBeenCalledOnce(); expect(screen.queryByRole('checkbox')).toBeNull();
});
it('shows the exact severity raise and unchanged due date before consent', async () => {
  render(<AlertExistingInvestigation alertId={99} />); await read(); expect(screen.getByText(/Investigation severity after linking: high/).textContent).toContain('raises severity from medium'); expect(screen.getByText(/existing due date is unchanged/)).toBeTruthy(); expect(save()).toHaveProperty('disabled', true);
});
it.each(['sent', 'failed', 'acknowledged', 'resolved'])('allows recorded alert status %s without changing it', async status => {
  get.mockResolvedValueOnce({ data: { ...preview, alert: { ...preview.alert, status } } }); render(<AlertExistingInvestigation alertId={99} />); await read(); expect(screen.getByText(new RegExp(`Alert status stays ${status}`))).toBeTruthy(); expect(post).not.toHaveBeenCalled();
});
it('rejects an unreviewed proposed severity in the preview', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, resulting_severity: 'critical' } }); render(<AlertExistingInvestigation alertId={99} />); fireEvent.change(id(), { target: { value: '12' } }); fireEvent.click(review()); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull();
});
it('rejects confirmation if the recorded severity is not the reviewed result', async () => {
  post.mockResolvedValueOnce({ data: { ...result, severity: 'critical' } }); render(<AlertExistingInvestigation alertId={99} />); await acknowledge(); fireEvent.click(save()); await screen.findByRole('alert'); expect(screen.queryByRole('link', { name: 'Open linked investigation #12' })).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});

it('a fixed investigation never loads automatically or accepts another destination from its disabled input', async () => {
  const onConfirmed = vi.fn(), onPendingChange = vi.fn(); render(<AlertExistingInvestigation alertId={99} investigationId={12} onConfirmed={onConfirmed} onPendingChange={onPendingChange} />); expect(id()).toHaveProperty('value', '12'); expect(id()).toHaveProperty('disabled', true); expect(get).not.toHaveBeenCalled(); fireEvent.change(id(), { target: { value: '13' } }); fireEvent.click(review()); await screen.findByRole('checkbox'); expect(get).toHaveBeenCalledExactlyOnceWith('/alerts/99/existing-investigations/12/preview'); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(save()); await waitFor(() => expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(true)); expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
});
it('an uncertain fixed-pair outcome releases its outer controls but never confirms a saved link', async () => {
  const onConfirmed = vi.fn(), onPendingChange = vi.fn(); post.mockRejectedValueOnce(new Error('Unknown outcome')); render(<AlertExistingInvestigation alertId={99} investigationId={12} onConfirmed={onConfirmed} onPendingChange={onPendingChange} />); fireEvent.click(review()); await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(save()); await screen.findByRole('alert'); expect(onConfirmed).not.toHaveBeenCalled(); expect(onPendingChange.mock.calls).toEqual([[true], [false]]); expect(post).toHaveBeenCalledTimes(1);
});
it('changing a fixed destination discards an earlier read and starts with no consent', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<AlertExistingInvestigation alertId={99} investigationId={12} />); fireEvent.click(review()); view.rerender(<AlertExistingInvestigation alertId={99} investigationId={13} />); expect(id()).toHaveProperty('value', '13'); await act(async () => finish({ data: preview })); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('Owned saved summary')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('a fixed invalid destination fails before any read', async () => {
  render(<AlertExistingInvestigation alertId={99} investigationId={0} />); fireEvent.click(review()); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
