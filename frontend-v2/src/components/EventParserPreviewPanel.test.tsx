import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventParserPreviewPanel } from './EventParserPreviewPanel';
import apiClient from '../api/client';
import { eventFilePreviewFingerprint } from '../utils/eventParserPreview';
vi.mock('../api/client', () => ({ default: { post: vi.fn() } }));
vi.mock('../utils/eventParserPreview', async original => ({ ...await original<typeof import('../utils/eventParserPreview')>(), eventFilePreviewFingerprint: vi.fn() }));
const hash = 'a'.repeat(64), post = vi.mocked(apiClient.post), fingerprint = vi.mocked(eventFilePreviewFingerprint);
const file = new File(['[{},{}]'], 'private.ndjson');
const counters = (extra = {}) => ({ format: 'onealert_event_parser_preview_v1', source_type: 'suricata', fingerprint: hash, byte_size: file.size, previewed_at: '2026-11-22T06:30:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 2, skip_reasons: { invalid_timestamp: 1 }, skipped_positions: { invalid_timestamp: { record_positions: [2], omitted_positions: 0 } }, ...extra });
const success = (extra = {}) => ({ data: { success: true, data: counters(extra) } });
const button = () => screen.getByRole('button', { name: 'Preview source parser without importing' });
const mount = (extra = {}) => { const onPreview = vi.fn(), onBusy = vi.fn(); return { ...render(<EventParserPreviewPanel file={file} sourceType="suricata" records={2} disabled={false} onPreview={onPreview} onBusy={onBusy} {...extra} />), onPreview, onBusy }; };
beforeEach(() => { fingerprint.mockResolvedValue(hash); post.mockResolvedValue(success()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
describe('Explicit source-parser preview', () => {
  it('does not hash, read from the server or post on mount', () => { mount(); expect(post).not.toHaveBeenCalled(); expect(fingerprint).not.toHaveBeenCalled(); expect(screen.getByText(/sends the selected file to the application server/)).toBeTruthy(); });
  it('posts exact original File once, validates counters and reports bounded one-based positions', async () => {
    const { onPreview, onBusy } = mount(); fireEvent.click(button()); await screen.findByLabelText('Loaded parser-preview counters');
    expect(post).toHaveBeenCalledTimes(1); const [url, body, options] = post.mock.calls[0];
    expect(url).toBe('/events/upload/preview'); expect((body as FormData).get('file')).toBe(file); expect(options?.params).toEqual({ source_type: 'suricata' });
    expect(onPreview).toHaveBeenLastCalledWith(counters()); expect(onBusy.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByText(/Parsed-record positions: 2/)).toBeTruthy(); expect(screen.getByText(/not NDJSON line numbers/)).toBeTruthy();
  });
  it('blocks duplicate requests while hashing and posts no request if hashing fails', async () => {
    let reject!: (error: Error) => void; fingerprint.mockReturnValue(new Promise((_, no) => { reject = no; }));
    mount(); const trigger = button(); fireEvent.click(trigger); fireEvent.click(trigger); expect(fingerprint).toHaveBeenCalledTimes(1);
    await act(async () => { reject(Error('private filename or secret')); }); expect(post).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByText(/private filename or secret/)).toBeNull();
  });
  it('blocks duplicate requests while the network is pending', async () => {
    let resolve!: (value: ReturnType<typeof success>) => void; post.mockReturnValue(new Promise(done => { resolve = done; }));
    mount(); fireEvent.click(button()); await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Checking source parser...' })); await act(async () => resolve(success())); expect(post).toHaveBeenCalledTimes(1);
  });
  it('ignores an unmounted request before it can send file bytes', async () => {
    let resolve!: (value: string) => void; fingerprint.mockReturnValue(new Promise(done => { resolve = done; }));
    const { unmount, onPreview } = mount(); fireEvent.click(button()); unmount(); await act(async () => resolve(hash));
    expect(post).not.toHaveBeenCalled(); expect(onPreview.mock.calls).toEqual([[null]]);
  });
  it('ignores a network reply after close without updating owner state', async () => {
    let resolve!: (value: ReturnType<typeof success>) => void; post.mockReturnValue(new Promise(done => { resolve = done; }));
    const { unmount, onPreview, onBusy } = mount(); fireEvent.click(button()); await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); unmount();
    await act(async () => resolve(success())); expect(onPreview.mock.calls).toEqual([[null]]); expect(onBusy.mock.calls).toEqual([[true]]);
  });
  it.each([
    ['different file bytes', { fingerprint: 'b'.repeat(64) }], ['different parser', { source_type: 'zeek' }], ['wrong byte count', { byte_size: 99 }], ['partial counters', { skipped: undefined }], ['wrong record count', { received: 3 }], ['bad positions', { skipped_positions: { invalid_timestamp: { record_positions: [0], omitted_positions: 0 } } }],
  ])('rejects %s without attaching a preview', async (_, extra) => {
    post.mockResolvedValue(success(extra)); const { onPreview } = mount(); fireEvent.click(button()); await screen.findByRole('alert');
    expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull(); expect(onPreview.mock.calls).toEqual([[null]]);
  });
  it('does not accept a non-success envelope', async () => { post.mockResolvedValue({ data: { success: false, data: counters() } }); mount(); fireEvent.click(button()); await screen.findByRole('alert'); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull(); });
  it('does not display raw transport error contents', async () => { post.mockRejectedValue({ response: { status: 500, data: { detail: 'SECRET_RAW_EVENT' } } }); mount(); fireEvent.click(button()); await screen.findByRole('alert'); expect(screen.queryByText(/SECRET_RAW_EVENT/)).toBeNull(); });
  it('shows zero accepted without pretending that an import completed', async () => { post.mockResolvedValue(success({ accepted: 0, skipped: 2, redactions_in_accepted: 0, skip_reasons: { invalid_timestamp: 2 }, skipped_positions: { invalid_timestamp: { record_positions: [1, 2], omitted_positions: 0 } } })); mount(); fireEvent.click(button()); await screen.findByText(/No records accepted by this parser/); expect(screen.queryByText('No events were imported.')).toBeNull(); });
  it('clears the old counters and owner attachment before a new explicit preview', async () => {
    const { onPreview } = mount(); fireEvent.click(button()); await screen.findByLabelText('Loaded parser-preview counters'); post.mockReturnValue(new Promise(() => {}));
    fireEvent.click(button()); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull(); expect(onPreview).toHaveBeenLastCalledWith(null);
  });
  it('cannot request a preview or download during import', () => { mount({ disabled: true }); fireEvent.click(button()); expect(post).not.toHaveBeenCalled(); expect(fingerprint).not.toHaveBeenCalled(); });
  it('downloads only allowlisted loaded metadata and performs no new request', async () => {
    post.mockResolvedValue(success({ raw_data: { secret: 'SECRET_RAW_EVENT' } }));
    let blob!: Blob; URL.createObjectURL = vi.fn(value => { blob = value as Blob; return 'blob:metadata'; }); URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount(); fireEvent.click(button()); await screen.findByLabelText('Loaded parser-preview counters'); fireEvent.click(screen.getByRole('button', { name: 'Download parser-preview metadata JSON' }));
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsText(blob); });
    const data = JSON.parse(text); expect(data.filename).toBe(file.name); expect(data.raw_data).toBeUndefined(); expect(text).not.toContain('SECRET_RAW_EVENT'); expect(data.scope).toContain('not NDJSON line numbers'); expect(post).toHaveBeenCalledTimes(1);
  });
});
