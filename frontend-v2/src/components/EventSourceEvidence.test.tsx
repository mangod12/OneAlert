import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { saveHuntDownload } from '../utils/huntEvidence';
import { EventSourceEvidence } from './EventSourceEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const data = () => ({ source: { id: 7, name: '<script>Gateway source</script>', source_type: 'suricata', status: 'active', event_count: 99, last_event_at: '2030-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }, retained_event_count: 11, first_observed_at: '2026-01-01T00:00:00Z', last_observed_at: '2026-11-01T00:00:00Z', first_created_at: '2026-11-01T00:00:00Z', last_created_at: '2026-11-02T00:00:00Z', nonempty_field_counts: { source_ip: 5, dest_ip: 11, hostname: 0, username: 2, domain: 3 }, groups: { severity: [{ value: 'custom', count: 10 }, { value: null, count: 1 }], event_type: Array.from({ length: 11 }, (_, i) => ({ value: `kind-${i}`, count: 1 })), source_type: [{ value: null, count: 11 }], processed: [{ value: '', count: 11 }] }, retrieved_at: '2026-11-22T00:00:00Z', scope: 'All retained owned source events, not live health or a complete ingestion history.' });
async function read() { fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); await screen.findByText('Retained owned events: 11'); }
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockResolvedValue({ data: data() }); });
afterEach(cleanup);
it('only reads exact selected source on request and shows recorded counter divergence without a health claim', async () => {
  render(<EventSourceEvidence sourceId={7} />); expect(get).not.toHaveBeenCalled(); await read(); expect(get).toHaveBeenCalledWith('/events/sources/7/recorded-evidence'); expect(screen.getByText("Source's recorded counter: 99")).toBeInTheDocument(); expect(screen.getByText(/not proof of data loss/)).toBeInTheDocument(); expect(screen.getByText('2030-01-01T00:00:00Z')).toBeInTheDocument(); expect(document.querySelector('script')).toBeNull();
});
it('keeps unfamiliar and missing labels and shows empty label separately', async () => {
  render(<EventSourceEvidence sourceId={7} />); await read(); expect(screen.getByText('custom')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Source profile label group'), { target: { value: 'processed' } }); expect(screen.getByText('(empty text)')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Source profile label group'), { target: { value: 'source_type' } }); expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
});
it('pages and searches all loaded group labels without fetching again', async () => {
  render(<EventSourceEvidence sourceId={7} />); await read(); fireEvent.change(screen.getByLabelText('Source profile label group'), { target: { value: 'event_type' } }); expect(screen.getByText('Page 1 of 2 · 11 labels')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'More source labels' })); expect(screen.getByText('kind-10')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Search source profile groups'), { target: { value: 'kind-10' } }); expect(screen.getByText('Page 1 of 1 · 1 label')).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});
it('downloads all loaded groups despite a filtered second page with no extra read', async () => {
  render(<EventSourceEvidence sourceId={7} />); await read(); fireEvent.change(screen.getByLabelText('Search source profile groups'), { target: { value: 'custom' } }); fireEvent.click(screen.getByRole('button', { name: 'Download loaded source profile JSON' })); const output = JSON.parse(save.mock.calls[0][0]); expect(output.groups.event_type).toHaveLength(11); expect(output.retained_event_count).toBe(11); expect(output.source.event_count).toBe(99); expect(output.download_scope).toContain('independent of display filters'); expect(get).toHaveBeenCalledTimes(1);
});
it.each(['source', 'retained_event_count', 'groups', 'nonempty_field_counts', 'retrieved_at', 'first_observed_at'])('refuses a malformed or incomplete profile %s', async key => {
  get.mockResolvedValueOnce({ data: { ...data(), [key]: 'wrong' } }); render(<EventSourceEvidence sourceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); expect(await screen.findByRole('alert')).toHaveTextContent('did not match'); expect(screen.queryByRole('button', { name: 'Download loaded source profile JSON' })).not.toBeInTheDocument();
});
it('refuses truncated group counts instead of inferring missing telemetry', async () => {
  const value = data(); value.groups.event_type.pop(); get.mockResolvedValueOnce({ data: value }); render(<EventSourceEvidence sourceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); expect(await screen.findByRole('alert')).toHaveTextContent('complete retained-event totals');
});
it('refuses duplicated labels and impossible coverage counts', async () => {
  const value = data(); value.nonempty_field_counts.hostname = 12; get.mockResolvedValueOnce({ data: value }); render(<EventSourceEvidence sourceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); expect(await screen.findByRole('alert')).toHaveTextContent('did not match');
});
it('keeps zero retained events distinct from a missing source counter and dates', async () => {
  const value = { ...data(), source: { ...data().source, event_count: null, last_event_at: null }, retained_event_count: 0, first_observed_at: null, last_observed_at: null, first_created_at: null, last_created_at: null, nonempty_field_counts: { source_ip: 0, dest_ip: 0, hostname: 0, username: 0, domain: 0 }, groups: { severity: [], event_type: [], source_type: [], processed: [] } }; get.mockResolvedValueOnce({ data: value }); render(<EventSourceEvidence sourceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); expect(await screen.findByText('Retained owned events: 0')).toBeInTheDocument(); expect(screen.getByText("Source's recorded counter: Not recorded")).toBeInTheDocument(); expect(screen.getByText(/not proof no telemetry arrived/)).toBeInTheDocument();
});
it('ignores late responses after clear', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); render(<EventSourceEvidence sourceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); fireEvent.click(screen.getByRole('button', { name: 'Clear source profile' })); await act(async () => resolve({ data: data() })); expect(screen.queryByText('Retained owned events: 11')).not.toBeInTheDocument();
});
it('clears an old profile when selecting another source and never auto-loads it', async () => {
  const view = render(<EventSourceEvidence sourceId={7} />); await read(); view.rerender(<EventSourceEvidence sourceId={8} />); expect(screen.queryByText('Retained owned events: 11')).not.toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});
it('treats failure as unavailable, not no events, and supports retry', async () => {
  get.mockRejectedValueOnce(Error('unavailable')); render(<EventSourceEvidence sourceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); expect(await screen.findByRole('alert')).toHaveTextContent('No absence'); await read();
});
it('reports download failures without losing loaded coverage or rereading', async () => {
  render(<EventSourceEvidence sourceId={7} />); await read(); save.mockImplementationOnce(() => { throw Error('failed'); }); fireEvent.click(screen.getByRole('button', { name: 'Download loaded source profile JSON' })); expect(screen.getByRole('alert')).toHaveTextContent('could not be downloaded'); expect(screen.getByText('Retained owned events: 11')).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});
