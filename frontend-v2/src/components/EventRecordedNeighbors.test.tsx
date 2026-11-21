import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { saveHuntDownload } from '../utils/huntEvidence';
import { EventRecordedNeighbors } from './EventRecordedNeighbors';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const anchor = { source_ip: '10.0.0.1', domain: 'example.test', hostname: null };
const data = (page = 1, field = 'source_ip', hours = 24) => ({ event_id: 99, field, value: field === 'domain' ? 'example.test' : '10.0.0.1', anchor_timestamp: '2026-11-01T12:00:00Z', hours, started_at: new Date(Date.parse('2026-11-01T12:00:00Z') - hours * 3600000).toISOString(), ended_before: new Date(Date.parse('2026-11-01T12:00:00Z') + hours * 3600000).toISOString(), page, size: 10, total: 11, records: Array.from({ length: page === 1 ? 10 : 1 }, (_, i) => ({ id: (page - 1) * 10 + i + 1, timestamp: '2026-11-01T12:00:00Z', event_type: 'dns', severity: 'info', signature: '<script>saved text</script>', source_ip: '10.0.0.1', dest_ip: null, hostname: null, username: null, domain: 'example.test', source_type: 'upload' })), retrieved_at: '2026-11-22T00:00:00Z', scope: 'Exact current same-field matches, not attribution' });
async function read() { fireEvent.click(screen.getByRole('button', { name: 'Read exact recorded neighbors' })); await screen.findByText(/11 other matching recorded events/); }
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockImplementation(async (_url, options) => { const p = options?.params as { page: number; field: string; hours: number }; return { data: data(p.page, p.field, p.hours) }; }); });
afterEach(cleanup);
it('does not read on mount or draft change and offers only nonempty recorded fields', () => {
  render(<EventRecordedNeighbors eventId={99} event={anchor} />); expect(get).not.toHaveBeenCalled(); expect(screen.queryByRole('option', { name: /hostname/ })).not.toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Neighbor anchor field'), { target: { value: 'domain' } }); expect(get).not.toHaveBeenCalled();
});
it('handles an anchor with no usable entity fields without an empty broad query', () => {
  render(<EventRecordedNeighbors eventId={99} event={{ hostname: '   ' }} />); expect(screen.getByText(/No supported nonempty entity fields/)).toBeInTheDocument(); expect(get).not.toHaveBeenCalled();
});
it('reads exact anchor scope, pages all matches and links exact original evidence', async () => {
  render(<EventRecordedNeighbors eventId={99} event={anchor} />); await read(); expect(get).toHaveBeenLastCalledWith('/events/99/recorded-neighbors', { params: { field: 'source_ip', hours: 24, page: 1, size: 10 } }); fireEvent.click(screen.getByRole('button', { name: 'More neighbor records' })); await screen.findByText(/Page 2 of 2/); expect(screen.getByRole('link', { name: 'Open exact neighbor event #11' })).toHaveAttribute('href', '/app/events/11'); expect(document.querySelector('script')).toBeNull();
});
it('keeps drafts unapplied and disables paging and loaded-page export', async () => {
  render(<EventRecordedNeighbors eventId={99} event={anchor} />); await read(); fireEvent.change(screen.getByLabelText('Neighbor hours each side'), { target: { value: '1' } }); expect(screen.getByText(/drafts are not applied/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'More neighbor records' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Download this loaded neighbor page JSON' })).toBeDisabled(); expect(get).toHaveBeenCalledTimes(1);
});
it('exports only loaded page and complete scope without new reads', async () => {
  render(<EventRecordedNeighbors eventId={99} event={anchor} />); await read(); fireEvent.click(screen.getByRole('button', { name: 'More neighbor records' })); await screen.findByText(/Page 2 of 2/); fireEvent.click(screen.getByRole('button', { name: 'Download this loaded neighbor page JSON' })); const payload = JSON.parse(save.mock.calls[0][0]); expect(payload.page).toBe(2); expect(payload.records).toHaveLength(1); expect(payload.total).toBe(11); expect(payload.download_scope).toContain('not every matching event'); expect(get).toHaveBeenCalledTimes(2);
});
it('warns when the current anchor value differs from previously loaded event fields', async () => {
  const value = data(); value.value = 'changed'; value.records = value.records.map(row => ({ ...row, source_ip: 'changed' })); get.mockResolvedValueOnce({ data: value }); render(<EventRecordedNeighbors eventId={99} event={anchor} />); await read(); expect(screen.getByText(/anchor field or timestamp changed since/)).toBeInTheDocument();
});
it.each(['event_id', 'field', 'hours', 'started_at', 'total', 'records'])('refuses malformed or broadened evidence %s', async key => {
  get.mockResolvedValueOnce({ data: { ...data(), [key]: key === 'records' ? [] : 'wrong' } }); render(<EventRecordedNeighbors eventId={99} event={anchor} />); fireEvent.click(screen.getByRole('button', { name: 'Read exact recorded neighbors' })); expect(await screen.findByRole('alert')).toHaveTextContent(/did not match|incomplete page/); expect(screen.queryByText(/11 other matching recorded events/)).not.toBeInTheDocument();
});
it('ignores late results after clear without inferring absence', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); render(<EventRecordedNeighbors eventId={99} event={anchor} />); fireEvent.click(screen.getByRole('button', { name: 'Read exact recorded neighbors' })); fireEvent.click(screen.getByRole('button', { name: 'Clear recorded neighbors' })); await act(async () => resolve({ data: data() })); expect(screen.queryByText(/matching recorded events/)).not.toBeInTheDocument();
});
it('keeps read failure separate from empty and can retry', async () => {
  get.mockRejectedValueOnce(Error('Unavailable')); render(<EventRecordedNeighbors eventId={99} event={anchor} />); fireEvent.click(screen.getByRole('button', { name: 'Read exact recorded neighbors' })); expect(await screen.findByRole('alert')).toHaveTextContent('No absence'); await read();
});
it('warns when the server anchor timestamp changed even if field text is unchanged', async () => {
  render(<EventRecordedNeighbors eventId={99} event={{ ...anchor, timestamp: '2026-10-01T12:00:00Z' }} />); await read(); expect(screen.getByText(/anchor field or timestamp changed since/)).toBeInTheDocument();
});
it('clamps a disappearing last page by reading the current last page', async () => {
  render(<EventRecordedNeighbors eventId={99} event={anchor} />); await read(); get.mockResolvedValueOnce({ data: { ...data(2), total: 1, records: [] } }).mockResolvedValueOnce({ data: { ...data(), total: 1, records: data().records.slice(0, 1) } }); fireEvent.click(screen.getByRole('button', { name: 'More neighbor records' })); await screen.findByText(/1 other matching recorded events/); expect(get).toHaveBeenLastCalledWith('/events/99/recorded-neighbors', { params: { field: 'source_ip', hours: 24, page: 1, size: 10 } });
});
it('shows local export failure without hiding loaded matches or rereading', async () => {
  render(<EventRecordedNeighbors eventId={99} event={anchor} />); await read(); save.mockImplementationOnce(() => { throw Error('failed'); }); fireEvent.click(screen.getByRole('button', { name: 'Download this loaded neighbor page JSON' })); expect(screen.getByRole('alert')).toHaveTextContent('could not be downloaded'); expect(screen.getByText(/11 other matching recorded events/)).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});
