import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RetainedHuntCurrentEvent } from './RetainedHuntCurrentEvent';
import { HuntQueryEvidence } from './HuntQueryEvidence';
const { get, save } = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../api/client', () => ({ default: { get } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: save, huntQueryCsv: vi.fn() }));
const fingerprint = 'a'.repeat(64), columns = ['id', 'source_ip', 'signature', 'bytes_in'];
const integer = (text: string) => ({ kind: 'integer', text, shortened: false });
const text = (text: string, shortened = false) => ({ kind: 'text', text, shortened });
const data = () => ({ session_id: 3, query_number: 1, row_number: 21, event_id: 221, fingerprint, current_available: true, field_count: 4, text_limit: 1000, retrieved_at: '2026-11-22T00:00:00Z', scope: 'Selected values only, not query reexecution.', fields: [
  { name: 'id', retained: integer('221'), current: integer('221'), equal: true },
  { name: 'source_ip', retained: text(''), current: { kind: 'null', text: null, shortened: false }, equal: false },
  { name: 'signature', retained: text('X'.repeat(1000), true), current: text('X'.repeat(1000), true), equal: false },
  { name: 'bytes_in', retained: integer('9007199254740993'), current: integer('9007199254740993'), equal: true },
] });
const show = (refresh = vi.fn()) => render(<RetainedHuntCurrentEvent sessionId={3} queryNumber={1} rowNumber={21} eventId={221} fingerprint={fingerprint} columns={columns} onClose={vi.fn()} onRefreshSaved={refresh} />);
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('compares exact selected fields with clipping markers, null/empty distinctions and exact large integers', async () => {
  get.mockResolvedValue({ data: data() }); show(); await screen.findByText('2 of 4 selected serialized fields differ.');
  expect(get).toHaveBeenCalledWith('/hunt/3/queries/1/retained-rows/21/current-evidence', { params: { fingerprint, expected_event_id: 221 } });
  expect(screen.getAllByText('9007199254740993')).toHaveLength(2); expect(screen.getByText('(null)')).toBeTruthy(); expect(screen.getByText('(empty text)')).toBeTruthy();
  expect(screen.getByText('signature · Different selected value')).toBeTruthy(); expect(screen.getAllByText(/shortened display/)).toHaveLength(2);
  expect(screen.getByRole('link').getAttribute('href')).toBe('/app/events/221');
  const calls = get.mock.calls.length; fireEvent.click(screen.getByRole('button', { name: 'Download loaded retained/current row comparison JSON' }));
  const parsed = JSON.parse(save.mock.calls[0][0]); expect(parsed.fields).toHaveLength(4); expect(parsed.fields[3].retained.text).toBe('9007199254740993'); expect(get.mock.calls.length).toBe(calls);
});
it.each([{ session_id: 4 }, { query_number: 2 }, { row_number: 22 }, { event_id: 222 }, { fingerprint: 'b'.repeat(64) },
  { fields: [] }, { field_count: 3 }, { text_limit: 500 }, { fields: [data().fields[0], data().fields[0], ...data().fields.slice(2)] },
  { fields: data().fields.map(f => ({ ...f, equal: true })) },
])('rejects wrong saved-row identity, incomplete fields and inconsistent comparison data %#', async change => {
  get.mockResolvedValue({ data: { ...data(), ...change } }); show(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/selected serialized fields differ/)).toBeNull();
});
it('requires refreshing the saved hunt after a 409, never substitutes replacement saved values', async () => {
  const refresh = vi.fn(); get.mockRejectedValue({ response: { status: 409, data: { detail: 'Saved evidence changed' } } }); show(refresh);
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Refresh saved hunt before comparing again' })); expect(refresh).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1); expect(screen.queryByRole('link')).toBeNull();
});
it('keeps unavailable current evidence separate from deletion or an all-clear', async () => {
  get.mockResolvedValue({ data: { ...data(), current_available: false, fields: [] } }); show(); await screen.findByText(/unavailable or outside your access/); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/selected serialized fields differ/)).toBeNull();
});
it('clears old values during a failed current refresh and supports retry', async () => {
  get.mockResolvedValueOnce({ data: data() }).mockRejectedValueOnce(Error('Unavailable')).mockResolvedValueOnce({ data: data() }); show(); await screen.findByText(/selected serialized fields differ/);
  fireEvent.click(screen.getByRole('button', { name: 'Read current event comparison again' })); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Read current event comparison again' })); await screen.findByText(/selected serialized fields differ/);
});
it('ignores a late current read after the comparison unmounts', async () => {
  let resolve: (v: unknown) => void = () => {}; get.mockImplementation(() => new Promise(r => { resolve = r; })); const view = show(); await waitFor(() => expect(get).toHaveBeenCalledTimes(1)); view.unmount(); await act(async () => { resolve({ data: data() }); }); expect(screen.queryByRole('link')).toBeNull();
});
it('retains original row positions after searching across local query pages', async () => {
  const refresh = vi.fn(); get.mockResolvedValue({ data: { ...data(), event_id: 21, field_count: 2, current_available: false, fields: [] } });
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, signature: i === 20 ? 'late-match' : `item-${i}` }));
  render(<HuntQueryEvidence index={0} result={{ outcome: 'completed', rows, row_count: 25, execution: { contract: 'scoped_select_v1', selected_columns: ['id', 'signature'], order_by: 'id', direction: 'ASC', requested_limit: null, row_limit: 100 } }} savedReview={{ sessionId: 3, fingerprint, onRefresh: refresh }} />);
  expect(get).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('Search retained rows for query 1'), { target: { value: 'late-match' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare current event for retained row 21' })); await screen.findByText(/unavailable or outside your access/);
  expect(get).toHaveBeenLastCalledWith('/hunt/3/queries/1/retained-rows/21/current-evidence', { params: { fingerprint, expected_event_id: 21 } });
});
