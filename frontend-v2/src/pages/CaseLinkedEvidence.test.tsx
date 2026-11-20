import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseLinkedEvidence } from './CaseLinkedEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const alert = { id: 100, title: 'Retained linked alert', severity: 'critical', status: 'resolved', created_at: '2026-11-01T00:00:00Z', description: null, can_open_original: true };
const snapshot = { case_id: 7, case_title: 'Saved investigation', kind: 'alert', search: '', severity: 'all', page: 1, size: 10, total: 1, available_count: 1, unavailable_reference_count: 2, records: [alert], retrieved_at: 'now' };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); }); afterEach(cleanup);
function setup(path = '/cases/7/evidence') {
  function Navigation() { const navigate = useNavigate(); return <><button onClick={() => navigate('/cases/8/evidence?kind=event')}>Next investigation</button><CaseLinkedEvidence /></>; }
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/cases/:caseId/evidence" element={<Navigation />} /></Routes></MemoryRouter>);
}
it('shows exact owned records and unavailable references without changing anything', async () => {
  setup(); await screen.findByText('Alert #100: Retained linked alert'); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/linked-evidence', { params: { kind: 'alert', search: '', severity: 'all', page: 1, size: 10 } });
  expect(screen.getByRole('link', { name: 'Open exact alert #100' }).getAttribute('href')).toBe('/app/alerts?alert=100'); expect(screen.getByText(/2 original references are unavailable/)).toBeTruthy(); expect(screen.getByText('Not recorded')).toBeTruthy();
});
it('preserves collaborator visibility without promising access to the owner-only original', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, records: [{ ...alert, can_open_original: false }] } }); setup(); await screen.findByText('Alert #100: Retained linked alert'); expect(screen.queryByRole('link', { name: 'Open exact alert #100' })).toBeNull(); expect(screen.getByText(/original record link is limited to its owner/)).toBeTruthy();
});
it('switches evidence types, applies literal search and keeps drafts distinct', async () => {
  get.mockImplementation(async (_url, config) => { const params = config?.params as Record<string, unknown>; return { data: { ...snapshot, ...params, records: params.kind === 'alert' ? [alert] : [{ id: 101, signature: 'Saved event', event_type: 'dns', timestamp: null, source_ip: null, can_open_original: true }] } }; }); setup(); await screen.findByText('Alert #100: Retained linked alert'); fireEvent.click(screen.getByRole('button', { name: 'Linked events' })); await screen.findByText('Event #101: Saved event'); expect(screen.getByRole('link', { name: 'Open exact event #101' }).getAttribute('href')).toBe('/app/events/101');
  fireEvent.change(screen.getByLabelText('Search linked investigation evidence'), { target: { value: '100%_' } }); expect(screen.getByText(/Search draft not applied/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Search linked evidence' })); await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/7/linked-evidence', { params: { kind: 'event', search: '100%_', severity: 'all', page: 1, size: 10 } }));
});
it.each([{ ...snapshot, case_id: 8 }, { ...snapshot, kind: 'event' }, { ...snapshot, search: 'other' }, { ...snapshot, severity: 'high' }, { ...snapshot, records: [{ ...alert, id: 0 }] }, { ...snapshot, records: [alert, alert] }, { ...snapshot, total: -1 }])('rejects a mismatched evidence page %#', async data => {
  get.mockResolvedValueOnce({ data }); setup(); await screen.findByRole('alert'); expect(screen.queryByText('Alert #100: Retained linked alert')).toBeNull();
});
it('clamps shrinking pages and keeps unavailable service separate from empty results', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, total: 11, available_count: 11 } }); setup(); await screen.findByText('Page 1 of 2'); get.mockResolvedValueOnce({ data: { ...snapshot, page: 2, records: [] } }); get.mockResolvedValueOnce({ data: snapshot }); fireEvent.click(screen.getByRole('button', { name: 'More linked evidence' })); await screen.findByText('Page 1 of 1');
  get.mockRejectedValueOnce(new Error('offline')); fireEvent.click(screen.getByRole('button', { name: 'Refresh linked investigation evidence' })); await screen.findByRole('alert'); expect(screen.queryByText(/No available linked/)).toBeNull(); expect(screen.queryByRole('link', { name: 'Open exact alert #100' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Refresh linked investigation evidence' })); await screen.findByText('Alert #100: Retained linked alert');
});
it('ignores a slow prior investigation response after URL navigation', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); setup(); get.mockResolvedValueOnce({ data: { ...snapshot, case_id: 8, kind: 'event', records: [{ id: 108, signature: 'New investigation event', can_open_original: false }] } }); fireEvent.click(screen.getByRole('button', { name: 'Next investigation' })); await screen.findByText('Event #108: New investigation event'); await act(async () => finish({ data: snapshot })); expect(screen.queryByText('Alert #100: Retained linked alert')).toBeNull();
});
it.each(['/cases/0/evidence', '/cases/01/evidence', '/cases/nope/evidence', '/cases/2147483648/evidence', '/cases/7/evidence?kind=', '/cases/7/evidence?kind=alert&kind=event', '/cases/7/evidence?kind=unknown'])('rejects malformed evidence link %s without loading a broader scope', async path => {
  setup(path); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
