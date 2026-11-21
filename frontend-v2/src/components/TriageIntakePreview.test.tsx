import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { TriageIntakePreview } from './TriageIntakePreview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { id: 7, label: 'Saved evidence', severity: 'high', recorded_at: '2026-11-21T11:00:00Z' };
const alerts = { eligible_count: 1, batch_limit: 100, batch_count: 1, deferred_count: 0, sample_limit: 10, sample: [row] };
const fixture = { hours_back: 72, retrieved_at: '2026-11-21T12:00:00Z', cutoff: '2026-11-18T12:00:00Z', alerts, events: { ...alerts, batch_limit: 500 } };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Preview automatic triage intake' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); });
afterEach(cleanup);
it('reads only on demand, shows exact original links and separates intake from running AI', async () => {
  render(<TriageIntakePreview />); expect(get).not.toHaveBeenCalled(); open();
  await screen.findByText('alerts: 1 eligible');
  expect(get).toHaveBeenCalledWith('/cases/triage-intake', { params: { hours_back: 72 } });
  expect(screen.getByText(/no AI call or case creation/)).toBeTruthy();
  expect(screen.getAllByRole('link', { name: '#7: Saved evidence' }).map(link => link.getAttribute('href'))).toEqual(['/app/alerts?alert=7', '/app/events/7']);
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('shows capped backlog and clearly labeled ten-record samples', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, alerts: { ...alerts, eligible_count: 105, batch_count: 100, deferred_count: 5, sample: Array.from({ length: 10 }, (_, i) => ({ ...row, id: i + 1 })) } } });
  render(<TriageIntakePreview />); open(); await screen.findByText('alerts: 105 eligible');
  expect(screen.getByText('Next batch: up to 100 of 100 maximum · Beyond this batch: 5')).toBeTruthy();
  expect(screen.getByText(/Showing 10 sampled records/)).toBeTruthy();
});
it.each([{ hours_back: 24 }, { alerts: { ...alerts, batch_count: 2 } }, { events: { ...fixture.events, sample: [] } }, { alerts: { ...alerts, sample: [{ ...row, label: {} }] } }])('rejects mismatched or incomplete intake %j', async changes => {
  get.mockResolvedValueOnce({ data: { ...fixture, ...changes } }); render(<TriageIntakePreview />); open();
  await screen.findByRole('alert'); expect(screen.queryByText('alerts: 1 eligible')).toBeNull();
});
it('clears stale reads on close and window changes and retries errors', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<TriageIntakePreview />); open(); open(); await act(async () => finish({ data: fixture }));
  expect(screen.queryByText('alerts: 1 eligible')).toBeNull();
  get.mockRejectedValueOnce(new Error('Unavailable')); open(); await screen.findByRole('alert');
  get.mockResolvedValueOnce({ data: fixture }); fireEvent.click(screen.getByRole('button', { name: 'Refresh triage intake' })); await screen.findByText('alerts: 1 eligible');
  get.mockResolvedValueOnce({ data: { ...fixture, hours_back: 24 } }); fireEvent.change(screen.getByLabelText('Preview lookback'), { target: { value: '24' } });
  await screen.findByText('alerts: 1 eligible'); expect(get.mock.calls.at(-1)?.[1]).toEqual({ params: { hours_back: 24 } });
});
it('does not call an empty intake proof of safety', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, alerts: { ...alerts, eligible_count: 0, batch_count: 0, sample: [] } } });
  render(<TriageIntakePreview />); open(); await screen.findByText(/does not establish that all threats are investigated/);
});
