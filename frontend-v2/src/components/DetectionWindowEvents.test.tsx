import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DetectionWindowEvents } from './DetectionWindowEvents';
const { get, save } = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../api/client', () => ({ default: { get } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: save }));
const row = (id: number) => ({ id, timestamp: '2026-11-01T01:00:00Z', event_type: 'alert', severity: null, signature: id === 1 ? '<b>Saved label</b>' : '', source_ip: '', dest_ip: null, shortened_fields: [] });
const result = (page = 1, run = 3) => ({ run_id: run, step_id: 9, window_from: '2026-11-01T00:00:00Z', window_until: '2026-11-02T00:00:00Z', recorded_total_events: 13, total: 11, page, size: 10, records: page === 1 ? Array.from({ length: 10 }, (_, i) => row(i + 1)) : [row(11)], retrieved_at: '2026-11-22T00:00:00Z', scope: 'Current owned window, not original run evidence.' });
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Read current events for this saved detection receipt' }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('reads only explicitly, pages exact receipt windows and downloads only the loaded page without a read', async () => {
  get.mockImplementation((_path, options) => Promise.resolve({ data: result(options.params.page) }));
  render(<DetectionWindowEvents runId={3} stepId={9} />); expect(get).not.toHaveBeenCalled(); open();
  await screen.findByText('11 current window events · Page 1 of 2');
  expect(get).toHaveBeenLastCalledWith('/cases/agents/runs/3/detection-receipts/9/events', { params: { page: 1, size: 10 } });
  expect(screen.getByText(/Current count 11 differs from the recorded run count 13/)).toBeTruthy();
  expect(screen.getByText('Event #1: <b>Saved label</b>').querySelector('b')).toBeNull();
  expect(screen.getByRole('link', { name: 'Open exact detection-window event #1' }).getAttribute('href')).toBe('/app/events/1');
  fireEvent.click(screen.getByRole('button', { name: 'More detection-window events' }));
  await screen.findByText('11 current window events · Page 2 of 2');
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Download loaded detection-window event page JSON' }));
  const saved = JSON.parse(save.mock.calls[0][0]); expect(saved.records.map((r: { id: number }) => r.id)).toEqual([11]);
  expect(saved.format).toBe('onealert_detection_window_event_page_v1'); expect(get.mock.calls.length).toBe(reads);
});
it.each([{ run_id: 4 }, { step_id: 10 }, { records: [row(1)] }, { records: Array(10).fill(row(1)) },
  { window_from: 'bad' }, { window_until: '2027-01-01T00:00:00Z' },
  { records: Array.from({ length: 10 }, (_, i) => ({ ...row(i + 1), timestamp: '2026-10-31T00:00:00Z' })) },
  { records: Array.from({ length: 10 }, (_, i) => ({ ...row(i + 1), shortened_fields: ['raw_data'] })) },
  { records: Array.from({ length: 10 }, (_, i) => row(10 - i)) },
  { records: Array.from({ length: 10 }, (_, i) => ({ ...row(i + 1), event_type: null })) },
])('rejects wrong identity, invalid bounds or incomplete/inconsistent pages %#', async change => {
  get.mockResolvedValue({ data: { ...result(), ...change } }); render(<DetectionWindowEvents runId={3} stepId={9} />); open();
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/11 current window events/)).toBeNull();
});
it('clears a prior page on failed refresh, then retries without inferring no activity', async () => {
  get.mockResolvedValueOnce({ data: result() }).mockRejectedValueOnce(Error('Unavailable')).mockResolvedValueOnce({ data: result() });
  render(<DetectionWindowEvents runId={3} stepId={9} />); open(); await screen.findByText(/11 current window events/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved-window event evidence' })); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved-window event evidence' })); await screen.findByText(/11 current window events/);
});
it('does not restore a late page after the panel closes', async () => {
  let resolve: (v: unknown) => void = () => {}; get.mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<DetectionWindowEvents runId={3} stepId={9} />); open(); await waitFor(() => expect(get).toHaveBeenCalledTimes(1)); open();
  await act(async () => { resolve({ data: result() }); }); expect(screen.queryByText(/11 current window events/)).toBeNull(); expect(screen.queryByRole('link')).toBeNull();
});
it('separates empty current evidence from a historical all-clear and reports download failures', async () => {
  get.mockResolvedValue({ data: { ...result(), total: 0, records: [] } }); save.mockImplementation(() => { throw Error('No download'); });
  render(<DetectionWindowEvents runId={3} stepId={9} />); open(); await screen.findByText(/No current owned events remain/);
  fireEvent.click(screen.getByRole('button', { name: 'Download loaded detection-window event page JSON' })); expect(screen.getByRole('alert').textContent).toContain('could not be downloaded');
});
