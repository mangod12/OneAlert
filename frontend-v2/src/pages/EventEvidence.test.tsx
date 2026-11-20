import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { EventEvidence } from './EventEvidence';
let eventId = '99';
vi.mock('react-router-dom', () => ({ useParams: () => ({ eventId }) }));
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const raw = '{"counter":9007199254740993,"empty":null}';
const snapshot = { event: { id: 99, source_id: 7, signature: 'Saved gateway event', source_ip: '10.0.0.7', source_port: 0, bytes_in: '9007199254740993', bytes_out: null }, source_state: 'owned', source: { id: 7, name: 'Gateway source', source_type: 'suricata', status: 'active', last_event_at: null }, raw_payload_json: raw, retrieved_at: 'now' };
beforeEach(() => { vi.resetAllMocks(); eventId = '99'; get.mockResolvedValue({ data: snapshot }); }); afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('loads an exact event without consulting the list and preserves large counters and raw payload text', async () => {
  render(<EventEvidence />); await screen.findByText('Saved gateway event'); expect(get).toHaveBeenCalledExactlyOnceWith('/events/99/evidence');
  expect(screen.getByText('9007199254740993')).toBeTruthy(); expect(screen.getByText('0')).toBeTruthy(); expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Exact stored payload JSON').textContent).toBe(raw); expect(screen.getByText('Gateway source')).toBeTruthy();
});
it.each(['bad', '0', '-1', '9007199254740992'])('rejects invalid identity %s without lookup', async id => {
  eventId = id; render(<EventEvidence />); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it.each([{ ...snapshot, event: { ...snapshot.event, id: 98 } }, { ...snapshot, source: { ...snapshot.source, id: 8 } }, { ...snapshot, source_state: 'unavailable' }, { ...snapshot, event: { ...snapshot.event, bytes_in: 9007199254740992 } }])('rejects mismatched record/source or lossy counter %#', async data => {
  get.mockResolvedValue({ data }); render(<EventEvidence />); await screen.findByRole('alert'); expect(screen.queryByText('Saved gateway event')).toBeNull();
});
it('labels unavailable source and absent payload without invented zero evidence', async () => {
  get.mockResolvedValue({ data: { ...snapshot, source_state: 'unavailable', source: null, raw_payload_json: null } }); render(<EventEvidence />);
  await screen.findByText(/The linked source is unavailable to this account/); expect(screen.getByText('No raw payload was recorded.')).toBeTruthy();
});
it('clears old evidence when refresh fails and disables download until reread succeeds', async () => {
  render(<EventEvidence />); await screen.findByText('Saved gateway event'); get.mockRejectedValueOnce(new Error('offline')); fireEvent.click(screen.getByRole('button', { name: 'Refresh exact event evidence' })); await screen.findByRole('alert'); expect(screen.queryByText('Saved gateway event')).toBeNull(); expect(screen.getByRole('button', { name: 'Download loaded event evidence JSON' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh exact event evidence' })); await screen.findByText('Saved gateway event');
});
it('ignores an older event read when navigation selects another record', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<EventEvidence />); eventId = '98'; get.mockResolvedValueOnce({ data: { ...snapshot, event: { ...snapshot.event, id: 98, signature: 'New event' } } });
  view.rerender(<EventEvidence />); await screen.findByText('New event'); await act(async () => resolve({ data: snapshot })); expect(screen.queryByText('Saved gateway event')).toBeNull();
});
it('downloads loaded evidence with raw JSON text and counter precision intact', async () => {
  const create = vi.fn((blob: Blob) => { expect(blob).toBeInstanceOf(Blob); return 'blob:evidence'; }); Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true }); Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<EventEvidence />); await screen.findByText('Saved gateway event'); fireEvent.click(screen.getByRole('button', { name: 'Download loaded event evidence JSON' }));
  const body = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(create.mock.calls[0][0]); });
  const evidence = JSON.parse(body); expect(evidence.raw_payload_json).toBe(raw); expect(evidence.event.bytes_in).toBe('9007199254740993'); expect(evidence.event.bytes_out).toBeNull();
});
