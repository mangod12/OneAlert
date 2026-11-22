import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { saveHuntDownload } from '../utils/huntEvidence';
import { SourceGroupEvents, type SourceGroupSelection } from './SourceGroupEvents';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const selection: SourceGroupSelection = { group: 'severity', value: 'custom', profileCount: 12, profileReadAt: '2026-11-22T00:00:00Z' };
const data = (page = 1, value: string | null = 'custom') => ({ source_id: 7, group: 'severity', value, missing: value === null, page, size: 10, total: 11, records: Array.from({ length: page === 1 ? 10 : 1 }, (_, index) => ({ id: 100 - (page - 1) * 10 - index, timestamp: '2026-11-01T00:00:00Z', event_type: 'dns', severity: value, signature: '<script>saved metadata</script>', source_type: 'upload', processed: 'pending', source_ip: '10.0.0.7', dest_ip: '10.0.0.53', hostname: 'gateway-a' })), retrieved_at: '2026-11-22T00:00:01Z', scope: 'Exact source and label' });
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockImplementation(async (_url, options) => { const p = options?.params as { page: number; value?: string; missing?: boolean }; return { data: data(p.page, p.missing ? null : p.value) }; }); });
afterEach(cleanup);
it('reads exact source label, shows separate profile/current counts and links original event', async () => {
  render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); await screen.findByText('11 current matching source events · Page 1 of 2'); expect(get).toHaveBeenLastCalledWith('/events/sources/7/group-events', { params: { group: 'severity', value: 'custom', page: 1, size: 10 } }); expect(screen.getByText(/Current count 11 differs from the prior loaded profile count 12/)).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Open exact source event #100' })).toHaveAttribute('href', '/app/events/100'); expect(document.querySelector('script')).toBeNull();
});
it.each([null, ''])('does not broaden missing or empty labels %s', async value => {
  render(<SourceGroupEvents sourceId={7} selection={{ ...selection, value }} onClose={vi.fn()} />); await screen.findByText('11 current matching source events · Page 1 of 2'); expect(get).toHaveBeenLastCalledWith('/events/sources/7/group-events', { params: { group: 'severity', ...(value === null ? { missing: true } : { value: '' }), page: 1, size: 10 } });
});
it('pages exact scope and downloads only the loaded page without another read', async () => {
  render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); await screen.findByText('11 current matching source events · Page 1 of 2'); fireEvent.click(screen.getByRole('button', { name: 'More source events' })); await screen.findByText('11 current matching source events · Page 2 of 2'); fireEvent.click(screen.getByRole('button', { name: 'Download loaded source event page JSON' })); const output = JSON.parse(save.mock.calls[0][0]); expect(output.records).toHaveLength(1); expect(output.records[0].id).toBe(90); expect(output.page).toBe(2); expect(output.prior_profile_count).toBe(12); expect(output.download_scope).toContain('not all matching events'); expect(get).toHaveBeenCalledTimes(2);
});
it.each(['source_id', 'group', 'value', 'missing', 'total', 'records', 'retrieved_at'])('rejects wrong or incomplete returned scope %s', async key => {
  get.mockResolvedValueOnce({ data: { ...data(), [key]: key === 'records' ? [] : 'wrong' } }); render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); expect(await screen.findByRole('alert')).toHaveTextContent(/did not match|incomplete page/); expect(screen.queryByRole('button', { name: 'Download loaded source event page JSON' })).not.toBeInTheDocument();
});
it('rejects rows outside the selected label even with a matching response envelope', async () => {
  get.mockResolvedValueOnce({ data: { ...data(), records: data().records.map(row => ({ ...row, severity: 'high' })) } }); render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); expect(await screen.findByRole('alert')).toHaveTextContent('did not match');
});
it('keeps failed reads distinct from empty matches and supports retry', async () => {
  get.mockRejectedValueOnce(Error('unavailable')); render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); expect(await screen.findByRole('alert')).toHaveTextContent('No absence'); fireEvent.click(screen.getByRole('button', { name: 'Refresh exact source events' })); await screen.findByText('11 current matching source events · Page 1 of 2');
});
it('ignores late data after unmount', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); const view = render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); view.unmount(); await act(async () => resolve({ data: data() })); expect(screen.queryByText(/current matching source events/)).not.toBeInTheDocument();
});
it('clamps a disappearing last page and rereads rather than showing false emptiness', async () => {
  render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); await screen.findByText('11 current matching source events · Page 1 of 2'); get.mockResolvedValueOnce({ data: { ...data(2), total: 1, records: [] } }).mockResolvedValueOnce({ data: { ...data(), total: 1, records: data().records.slice(0, 1) } }); fireEvent.click(screen.getByRole('button', { name: 'More source events' })); await screen.findByText('1 current matching source events · Page 1 of 1'); expect(get).toHaveBeenCalledTimes(3);
});

it('does not spread unexpected response or nested event payload fields into a metadata page download', async () => {
  const value = data(); Object.assign(value, { credentials: 'PRIVATE_EXTRA', scope: 'PRIVATE_EXTRA' }); value.records.forEach(row => Object.assign(row, { raw_data: { value: 'PRIVATE_EXTRA' } })); get.mockResolvedValueOnce({ data: value });
  render(<SourceGroupEvents sourceId={7} selection={selection} onClose={vi.fn()} />); await screen.findByText('11 current matching source events · Page 1 of 2'); fireEvent.click(screen.getByRole('button', { name: 'Download loaded source event page JSON' })); expect(save.mock.calls[0][0]).not.toContain('PRIVATE_EXTRA'); expect(JSON.parse(save.mock.calls[0][0]).records).toHaveLength(10); expect(get).toHaveBeenCalledTimes(1);
});
