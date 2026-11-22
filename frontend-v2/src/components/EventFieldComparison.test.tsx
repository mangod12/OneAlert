import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { saveHuntDownload } from '../utils/huntEvidence';
import { eventComparisonFields, validComparedSnapshot } from '../utils/eventComparison';
import { EventFieldComparison } from './EventFieldComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const evidence = (id: number): { event: Record<string, unknown>; retrieved_at: string; raw_payload_json: string; source: { private: string } } => ({ event: { ...Object.fromEntries(eventComparisonFields.map(field => [field, null])), id, timestamp: '2026-11-01T12:00:00Z', created_at: '2026-11-01T12:01:00Z', event_type: 'dns', bytes_in: id === 99 ? '9223372036854775807' : '9223372036854775806', bytes_out: id === 99 ? null : '0', hostname: id === 99 ? '' : null, signature: '<script>not executable</script>' }, retrieved_at: '2026-11-22T00:00:00Z', raw_payload_json: '{"private":"omit"}', source: { private: 'omit source config' } });
const setTarget = (value = '100') => fireEvent.change(screen.getByLabelText('Comparison event ID'), { target: { value } });
async function read() { setTarget(); fireEvent.click(screen.getByRole('button', { name: 'Read both event records' })); await screen.findByText('3 of 23 compared fields differ.'); }
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockImplementation(async url => ({ data: evidence(Number(String(url).split('/')[2])) })); });
afterEach(cleanup);
it('only reads on explicit valid pair submission and rereads both exact current records', async () => {
  render(<EventFieldComparison eventId={99} />); expect(get).not.toHaveBeenCalled(); setTarget(); expect(get).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Read both event records' })); await screen.findByText('3 of 23 compared fields differ.'); expect(get.mock.calls.map(call => call[0])).toEqual(['/events/99/evidence', '/events/100/evidence']); expect(screen.getByRole('link', { name: 'Open original event #100' })).toHaveAttribute('href', '/app/events/100'); expect(document.querySelector('script')).toBeNull();
});
it.each(['', '99', '0', '-3', '+3', '1.2', '1e3', '9007199254740992', '/app/events/100'])('does not read invalid or same target %s', value => {
  render(<EventFieldComparison eventId={99} />); setTarget(value); expect(screen.getByRole('button', { name: 'Read both event records' })).toBeDisabled(); expect(get).not.toHaveBeenCalled();
});
it('preserves exact large counter text and distinguishes null, zero and empty text', async () => {
  render(<EventFieldComparison eventId={99} />); await read(); expect(screen.getByText('9223372036854775807')).toBeInTheDocument(); expect(screen.getByText('9223372036854775806')).toBeInTheDocument(); expect(screen.getByText('(empty text)')).toBeInTheDocument(); expect(screen.getAllByText('(not recorded)')).toHaveLength(2); expect(screen.getByText('0')).toBeInTheDocument();
});
it('keeps full loaded pair export independent of local filters without private payload or extra fetch', async () => {
  render(<EventFieldComparison eventId={99} />); await read(); fireEvent.change(screen.getByLabelText('Search event comparison fields'), { target: { value: 'hostname' } }); fireEvent.click(screen.getByRole('button', { name: 'Download loaded event field comparison JSON' })); const text = save.mock.calls[0][0], output = JSON.parse(text); expect(output.baseline.event.id).toBe(99); expect(output.comparison.event.id).toBe(100); expect(output.compared_fields).toHaveLength(23); expect(output.differing_fields).toEqual(['hostname', 'bytes_in', 'bytes_out']); expect(output.baseline.event.bytes_in).toBe('9223372036854775807'); expect(text).not.toContain('omit'); expect(output).not.toHaveProperty('raw_payload_json'); expect(get).toHaveBeenCalledTimes(2);
});
it('blocks export of an unapplied target but keeps loaded pair labeled', async () => {
  render(<EventFieldComparison eventId={99} />); await read(); setTarget('101'); expect(screen.getByRole('button', { name: 'Download loaded event field comparison JSON' })).toBeDisabled(); expect(screen.getByText(/ID draft is not applied/)).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Open original event #100' })).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(2);
});
it('filters and pages only the loaded compared fields and resets pages after filtering', async () => {
  render(<EventFieldComparison eventId={99} />); await read(); fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByText('Page 1 of 3 · 23 matching fields')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'More event fields' })); expect(screen.getByText('Page 2 of 3 · 23 matching fields')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Search event comparison fields'), { target: { value: 'bytes in' } }); expect(screen.getByText('Page 1 of 1 · 1 matching fields')).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(2);
});
it('does not equate a failed or missing counterpart with no differences and can retry', async () => {
  get.mockRejectedValueOnce(Error('not found')); render(<EventFieldComparison eventId={99} />); setTarget(); fireEvent.click(screen.getByRole('button', { name: 'Read both event records' })); expect(await screen.findByRole('alert')).toHaveTextContent('No equality'); expect(screen.queryByText(/compared fields differ/)).not.toBeInTheDocument(); await read();
});
it.each(['id', 'timestamp', 'bytes_in', 'source_id', 'source_port', 'hostname'])('refuses malformed evidence field %s and never exports it', async field => {
  const bad = evidence(99); bad.event[field] = field === 'id' ? 100 : field === 'hostname' ? undefined : {}; get.mockResolvedValueOnce({ data: bad }); render(<EventFieldComparison eventId={99} />); setTarget(); fireEvent.click(screen.getByRole('button', { name: 'Read both event records' })); expect(await screen.findByRole('alert')).toHaveTextContent('did not match'); expect(screen.queryByRole('button', { name: 'Download loaded event field comparison JSON' })).not.toBeInTheDocument();
});
it('ignores a late pair after clear', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); render(<EventFieldComparison eventId={99} />); setTarget(); fireEvent.click(screen.getByRole('button', { name: 'Read both event records' })); fireEvent.click(screen.getByRole('button', { name: 'Clear event comparison' })); await act(async () => resolve({ data: evidence(99) })); expect(screen.queryByText(/compared fields differ/)).not.toBeInTheDocument();
});
it('clears comparison and target on baseline route change', async () => {
  const view = render(<EventFieldComparison eventId={99} />); await read(); view.rerender(<EventFieldComparison eventId={101} />); expect(screen.getByLabelText('Comparison event ID')).toHaveValue(''); expect(screen.queryByText(/compared fields differ/)).not.toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(2);
});
it('explains equal compared fields without equating events or payloads', async () => {
  get.mockImplementation(async url => { const id = Number(String(url).split('/')[2]); return { data: { ...evidence(id), event: { ...evidence(99).event, id } } }; }); render(<EventFieldComparison eventId={99} />); setTarget(); fireEvent.click(screen.getByRole('button', { name: 'Read both event records' })); await screen.findByText('0 of 23 compared fields differ.'); expect(screen.getByText(/does not establish equivalent events/)).toBeInTheDocument();
});
it('reports local download failure without another read or losing the pair', async () => {
  render(<EventFieldComparison eventId={99} />); await read(); save.mockImplementationOnce(() => { throw Error('blocked'); }); fireEvent.click(screen.getByRole('button', { name: 'Download loaded event field comparison JSON' })); expect(screen.getByRole('alert')).toHaveTextContent('could not be downloaded'); expect(screen.getByText('3 of 23 compared fields differ.')).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(2);
});
it('validates optional zero ports and unavailable metadata without coercing numbers', () => {
  const value = evidence(99); value.event.source_port = 0; expect(validComparedSnapshot(value, 99)).toBe(true); value.event.bytes_in = 123; expect(validComparedSnapshot(value, 99)).toBe(false);
});
