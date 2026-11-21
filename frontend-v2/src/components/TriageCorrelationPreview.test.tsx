import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { TriageCorrelationPreview } from './TriageCorrelationPreview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const sample = { id: 7, label: 'Saved gateway event', severity: 'high', recorded_at: null };
const group = { position: 1, basis: 'shared_ip_component', alert_count: 0, event_count: 52, alert_ai_input_count: 0, event_ai_input_count: 50, alert_sample: [], event_sample: Array.from({ length: 5 }, (_, i) => ({ ...sample, id: i + 1 })) };
const fixture = { hours_back: 72, cutoff: '2026-11-18T12:00:00Z', retrieved_at: '2026-11-21T12:00:00Z', page: 1, size: 10, groups_total: 1, alerts_selected: 0, events_selected: 53, events_excluded_info_only: 1, records: [group] };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Preview triage correlation groups' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); });
afterEach(cleanup);
it('reads real grouping scope on demand with samples, omitted-input warning and no mutations', async () => {
  render(<TriageCorrelationPreview />); expect(get).not.toHaveBeenCalled(); open(); await screen.findByText(/1 candidate groups/);
  expect(get).toHaveBeenCalledWith('/cases/triage-correlation', { params: { hours_back: 72, page: 1 } });
  expect(screen.getByText(/0 alerts and 2 events would be omitted/)).toBeTruthy(); expect(screen.getByText(/not an AI nonincident decision/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'event #1: Saved gateway event' }).getAttribute('href')).toBe('/app/events/1');
  expect(screen.getByText(/shared gateway can connect unrelated activity/)).toBeTruthy(); expect(apiClient.post).not.toHaveBeenCalled();
});
it.each([{ hours_back: 24 }, { page: 2 }, { groups_total: -1 }, { events_selected: 501 }, { events_excluded_info_only: 54 }, { records: [] }, { cutoff: 'bad' }, { events_selected: 54 }, { events_excluded_info_only: 2 }, { records: [{ ...group, event_ai_input_count: 52 }] }, { records: [{ ...group, basis: 'shared_asset' }] }, { records: [{ ...group, event_sample: [] }] }])('rejects mismatched or incomplete preview %j', async changes => {
  get.mockResolvedValueOnce({ data: { ...fixture, ...changes } }); render(<TriageCorrelationPreview />); open(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('paginates then clamps after current groups shrink', async () => {
  const small = { ...group, event_count: 1, event_ai_input_count: 1, event_sample: [sample] };
  const large = { ...fixture, groups_total: 11, records: Array.from({ length: 10 }, (_, i) => ({ ...small, position: i + 1 })) };
  get.mockResolvedValueOnce({ data: large }); render(<TriageCorrelationPreview />); open(); await screen.findByText('Page 1 of 2');
  get.mockResolvedValueOnce({ data: { ...large, page: 2, records: [{ ...group, position: 11 }] } }); fireEvent.click(screen.getByRole('button', { name: 'More candidate groups' })); await screen.findByText('Page 2 of 2');
  get.mockResolvedValueOnce({ data: { ...fixture, page: 2, records: [] } }).mockResolvedValueOnce({ data: fixture }); fireEvent.click(screen.getByRole('button', { name: 'Refresh correlation preview' })); await screen.findByText('Page 1 of 1');
});
it('switches windows, ignores late replies and retries errors without agent execution', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<TriageCorrelationPreview />); open(); get.mockRejectedValueOnce(new Error('Offline')); fireEvent.change(screen.getByLabelText('Correlation preview lookback'), { target: { value: '24' } }); await screen.findByRole('alert');
  await act(async () => finish({ data: fixture })); expect(screen.queryByRole('link')).toBeNull();
  get.mockResolvedValueOnce({ data: { ...fixture, hours_back: 24, cutoff: '2026-11-20T12:00:00Z' } }); fireEvent.click(screen.getByRole('button', { name: 'Refresh correlation preview' })); await screen.findByText(/1 candidate groups/);
});
it('does not interpret empty groups as no incident', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, groups_total: 0, alerts_selected: 0, events_selected: 1, events_excluded_info_only: 1, records: [] } });
  render(<TriageCorrelationPreview />); open(); await screen.findByText(/does not establish that there are no incidents/);
});
