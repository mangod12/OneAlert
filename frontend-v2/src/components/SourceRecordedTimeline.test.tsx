import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SourceRecordedTimeline } from './SourceRecordedTimeline';
import { saveHuntDownload } from '../utils/huntEvidence';
import { validTimeline, validWindow, validWindowPage } from '../utils/sourceTimeline';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const start = '2026-11-01T00:00:00Z', end = '2026-11-02T00:00:00Z';
const timeline = () => ({ source_id: 7, started_at: start, ended_before: end, bucket_hours: 1, total: 10, retrieved_at: '2026-11-22T00:00:00Z', scope: 'Exact recorded window', buckets: Array.from({ length: 24 }, (_, index) => ({ started_at: new Date(Date.parse(start) + index * 3600000).toISOString(), ended_before: new Date(Date.parse(start) + (index + 1) * 3600000).toISOString(), count: index === 0 ? 10 : 0 })) });
const events = (page = 1) => ({ source_id: 7, started_at: start, ended_before: '2026-11-01T01:00:00Z', total: 11, page, size: 10, retrieved_at: '2026-11-22T00:00:01Z', scope: 'Exact window', records: Array.from({ length: page === 1 ? 10 : 1 }, (_, index) => ({ id: page === 1 ? index + 1 : 11, timestamp: start, event_type: 'dns', severity: 'custom', signature: '<script>saved text</script>', source_ip: '10.0.0.7', dest_ip: '10.0.0.53', hostname: 'gateway-a', source_type: 'upload', processed: 'pending' })) });
function show() { return render(<SourceRecordedTimeline sourceId={7} lastObservedAt="2026-11-01T23:45:00Z" />); }
function read() { fireEvent.click(screen.getByRole('button', { name: 'Read saved observation distribution' })); }
async function ready() { read(); await screen.findByText('10 retained rows in 24 UTC buckets · Source #7'); }
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockImplementation(async (url, options) => ({ data: String(url).endsWith('recorded-window-events') ? events((options?.params as { page: number }).page) : timeline() })); });
afterEach(cleanup);
it('defaults to the saved UTC observation day and reads only on explicit submit', async () => {
  show(); expect(get).not.toHaveBeenCalled(); expect(screen.getByLabelText('Observation distribution UTC start')).toHaveValue('2026-11-01T00:00'); await ready(); expect(get).toHaveBeenCalledTimes(1); expect(get.mock.calls[0]).toEqual(['/events/sources/7/recorded-timeline', { params: { started_at: '2026-11-01T00:00Z', ended_before: '2026-11-02T00:00Z', bucket_hours: 1 } }]); expect(screen.getAllByText('0 retained rows')).toHaveLength(11);
});
it('normalizes the default day to UTC rather than the source offset date', () => {
  render(<SourceRecordedTimeline sourceId={7} lastObservedAt="2026-11-02T00:30:00+05:30" />); expect(screen.getByLabelText('Observation distribution UTC start')).toHaveValue('2026-11-01T00:00');
});
it('pages only the loaded bucket display and exports the complete distribution without a read', async () => {
  show(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'More time buckets' })); expect(screen.getByText('Bucket page 2 of 2')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Download complete loaded distribution JSON' })); expect(JSON.parse(save.mock.calls[0][0]).buckets).toHaveLength(24); expect(get).toHaveBeenCalledTimes(1);
});
it('opens exact bucket events explicitly, keeps prior/current counts separate and pages to exact evidence', async () => {
  show(); await ready(); expect(get).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Read bucket events from 2026-11-01T00:00:00.000Z' })); await screen.findByText('11 current bucket events · Page 1 of 2'); expect(screen.getByText(/Current count 11 differs from the prior bucket count 10/)).toBeInTheDocument(); expect(get.mock.calls[1]).toEqual(['/events/sources/7/recorded-window-events', { params: { started_at: '2026-11-01T00:00:00.000Z', ended_before: '2026-11-01T01:00:00.000Z', page: 1, size: 10 } }]); fireEvent.click(screen.getByRole('button', { name: 'More bucket records' })); await screen.findByText('11 current bucket events · Page 2 of 2'); expect(screen.getByRole('link', { name: 'Open exact bucket event #11' })).toHaveAttribute('href', '/app/events/11'); expect(document.querySelector('script')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded bucket event page JSON' })); const output = JSON.parse(save.mock.calls[0][0]); expect(output.records).toHaveLength(1); expect(output.prior_bucket_count).toBe(10); expect(get).toHaveBeenCalledTimes(3);
});
it('requires draft window changes to be applied before distribution paging, export or new bucket reads', async () => {
  show(); await ready(); fireEvent.change(screen.getByLabelText('Observation distribution UTC end'), { target: { value: '2026-11-03T00:00' } }); expect(screen.getByRole('button', { name: 'More time buckets' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Download complete loaded distribution JSON' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Read bucket events from 2026-11-01T00:00:00.000Z' })).toBeDisabled(); expect(get).toHaveBeenCalledTimes(1);
});
it.each(['2026-11-01T00:00', '2026-12-03T00:00', '2026-11-02T00:01', '2101-01-01T00:00', ''])('blocks invalid window end %s without a read', value => {
  show(); fireEvent.change(screen.getByLabelText('Observation distribution UTC end'), { target: { value } }); expect(screen.getByRole('button', { name: 'Read saved observation distribution' })).toBeDisabled(); expect(get).not.toHaveBeenCalled();
});
it('blocks unaligned six-hour boundaries without silently rounding them', () => {
  show(); fireEvent.change(screen.getByLabelText('Observation distribution UTC start'), { target: { value: '2026-11-01T01:00' } }); fireEvent.change(screen.getByLabelText('Observation distribution bucket hours'), { target: { value: '6' } }); expect(screen.getByRole('button', { name: 'Read saved observation distribution' })).toBeDisabled(); expect(get).not.toHaveBeenCalled();
});
it.each(['source_id', 'bucket_hours', 'total', 'buckets', 'started_at', 'retrieved_at'])('rejects malformed distribution %s instead of implying absent records', async key => {
  get.mockResolvedValueOnce({ data: { ...timeline(), [key]: key === 'buckets' ? [] : 'wrong' } }); show(); read(); expect(await screen.findByRole('alert')).toHaveTextContent('did not match'); expect(screen.queryByRole('button', { name: 'Download complete loaded distribution JSON' })).toBeNull();
});
it('rejects missing or out-of-order zero buckets and count sums that do not add up', () => {
  const value = timeline(); value.buckets[1].count = 1; expect(validTimeline(value, 7, value, 1)).toBe(false); value.buckets[1].count = 0; value.buckets.reverse(); expect(validTimeline(value, 7, value, 1)).toBe(false);
});
it('keeps failed reads distinct from zero buckets and supports explicit retry', async () => {
  get.mockRejectedValueOnce(Error('unavailable')); show(); read(); expect(await screen.findByRole('alert')).toHaveTextContent('No absence'); expect(screen.queryByText(/retained rows in/)).toBeNull(); await ready();
});
it('invalidates a pending distribution on clear and does not resurrect closed results', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); show(); read(); fireEvent.click(screen.getByRole('button', { name: 'Clear observation distribution' })); await act(async () => finish({ data: timeline() })); expect(screen.queryByText(/retained rows in/)).toBeNull(); await ready();
});
it('clamps a disappearing event page and rereads its last available page', async () => {
  show(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Read bucket events from 2026-11-01T00:00:00.000Z' })); await screen.findByText('11 current bucket events · Page 1 of 2'); get.mockResolvedValueOnce({ data: { ...events(2), total: 1, records: [] } }).mockResolvedValueOnce({ data: { ...events(), total: 1, records: events().records.slice(0, 1) } }); fireEvent.click(screen.getByRole('button', { name: 'More bucket records' })); await screen.findByText('1 current bucket events · Page 1 of 1'); expect(get).toHaveBeenCalledTimes(4);
});
it('drops a late bucket reply after distribution clear', async () => {
  show(); await ready(); let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); fireEvent.click(screen.getByRole('button', { name: 'Read bucket events from 2026-11-01T00:00:00.000Z' })); fireEvent.click(screen.getByRole('button', { name: 'Clear observation distribution' })); await act(async () => finish({ data: events() })); expect(screen.queryByText(/current bucket events/)).toBeNull();
});
it.each(['source_id', 'started_at', 'records', 'total'])('rejects a malformed event page %s', async key => {
  show(); await ready(); get.mockResolvedValueOnce({ data: { ...events(), [key]: key === 'records' ? [] : 'wrong' } }); fireEvent.click(screen.getByRole('button', { name: 'Read bucket events from 2026-11-01T00:00:00.000Z' })); expect(await screen.findByRole('alert')).toHaveTextContent(/scope|incomplete/); expect(screen.queryByRole('button', { name: 'Download loaded bucket event page JSON' })).toBeNull();
});
it('validates exact inclusive/exclusive row timestamps and complete safe windows', () => {
  const value = events(); value.records[0].timestamp = value.ended_before; expect(validWindowPage(value, 7, value, 1)).toBe(false); expect(validWindow({ started_at: start, ended_before: end })).toBe(true); expect(validWindow({ started_at: '2026-11-01T01:00Z', ended_before: end }, 6)).toBe(false);
});
it('shows a failed download without discarding loaded data', async () => {
  show(); await ready(); save.mockImplementationOnce(() => { throw Error('download unavailable'); }); fireEvent.click(screen.getByRole('button', { name: 'Download complete loaded distribution JSON' })); expect(await screen.findByRole('alert')).toHaveTextContent('could not be downloaded'); expect(screen.getByText('10 retained rows in 24 UTC buckets · Source #7')).toBeInTheDocument();
});
