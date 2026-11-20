import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SuppressionMatchEvidence } from './SuppressionMatchEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const snapshot = { rule: { id: 99, name: 'Known gateway noise', enabled: false, cve_id: null, asset_id: 7, severity: 'high', title_contains: 'Gateway check', duration_hours: 24, created_at: '2026-11-20' }, page: 1, size: 10, scope: 'active', search: '', total: 11, matching_total: 11, criteria_present: true, retrieved_at: 'now', alerts: [{ id: 209, asset_id: 7, title: 'Saved gateway check', cve_id: null, severity: 'high', status: 'pending', created_at: '2026-11-20' }] };
const show = (id='99') => render(<MemoryRouter initialEntries={[`/rules/${id}`]}><Routes><Route path="/rules/:ruleId" element={<SuppressionMatchEvidence />} /></Routes></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); }); afterEach(cleanup);
it('reads an exact saved rule, labels paused criteria and links exact matching alerts', async () => {
  show(); await screen.findByText('Rule #99: Known gateway noise'); expect(screen.getByText(/Paused, criteria shown for inspection/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open exact alert #209' }).getAttribute('href')).toBe('/app/alerts?alert=209');
  expect(get).toHaveBeenCalledExactlyOnceWith('/suppression-rules/99/matching-alerts', { params: { page: 1, size: 10, search: '', scope: 'active' } });
});
it('pages full criteria matches and applies status/search scope independently', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as object) } })); show(); await screen.findByText('Alert #209: Saved gateway check');
  fireEvent.click(screen.getByRole('button', { name: 'More rule matches' })); await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText('Search rule matches'), { target: { value: '  CVE-2026  ' } }); expect(get).toHaveBeenCalledTimes(2); expect(screen.getByText(/Draft search not applied/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search matching alerts' })); await waitFor(() => expect(get).toHaveBeenLastCalledWith('/suppression-rules/99/matching-alerts', { params: { page: 1, size: 10, search: 'CVE-2026', scope: 'active' } }));
  fireEvent.change(screen.getByLabelText('Rule match status scope'), { target: { value: 'all' } }); await waitFor(() => expect(get).toHaveBeenLastCalledWith('/suppression-rules/99/matching-alerts', { params: { page: 1, size: 10, search: 'CVE-2026', scope: 'all' } }));
});
it.each(['bad', '0', '-1', '9007199254740992'])('rejects invalid exact rule identity %s without a lookup', async id => {
  show(id); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it.each([{ ...snapshot, rule: { ...snapshot.rule, id: 98 } }, { ...snapshot, page: 2 }, { ...snapshot, search: 'other' }, { ...snapshot, scope: 'all' }])('rejects mismatched result scope %#', async data => {
  get.mockResolvedValue({ data }); show(); await screen.findByRole('alert'); expect(screen.queryByText('Alert #209: Saved gateway check')).toBeNull();
});
it('clears evidence when refresh fails and allows an explicit reread', async () => {
  show(); await screen.findByText('Alert #209: Saved gateway check'); get.mockRejectedValueOnce(new Error('offline')); fireEvent.click(screen.getByRole('button', { name: 'Refresh rule evidence' })); await screen.findByRole('alert'); expect(screen.queryByText('Alert #209: Saved gateway check')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh rule evidence' })); await screen.findByText('Alert #209: Saved gateway check');
});
it('flags a legacy rule with no criteria without changing it', async () => {
  get.mockResolvedValue({ data: { ...snapshot, criteria_present: false } }); show(); await screen.findByText(/This legacy record has no criteria/); expect(get).toHaveBeenCalledTimes(1);
});
it('ignores an old active-status response after switching to all statuses', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; })); show(); get.mockResolvedValueOnce({ data: { ...snapshot, scope: 'all', total: 0, matching_total: 0, alerts: [] } });
  fireEvent.change(screen.getByLabelText('Rule match status scope'), { target: { value: 'all' } }); await screen.findByText(/No current alert rows match this scope/);
  await act(async () => resolve({ data: snapshot })); expect(screen.queryByText('Alert #209: Saved gateway check')).toBeNull();
});
it('recovers a vanished page to the current last page', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as object), total: get.mock.calls.length === 1 ? 11 : 1 } }));
  show(); await screen.findByText('Alert #209: Saved gateway check'); fireEvent.click(screen.getByRole('button', { name: 'More rule matches' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3)); expect(screen.getByRole('button', { name: 'Previous rule matches' })).toHaveProperty('disabled', true);
});
