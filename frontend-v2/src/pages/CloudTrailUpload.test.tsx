import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Events } from './Events';
import apiClient from '../api/client';
import { eventFilePreviewFingerprint } from '../utils/eventParserPreview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../utils/eventParserPreview', async original => ({ ...await original<typeof import('../utils/eventParserPreview')>(), eventFilePreviewFingerprint: vi.fn() }));
const hash = 'd'.repeat(64);
const body = JSON.stringify({ Records: [{ eventVersion: '1.11', eventTime: '2026-01-01T00:00:00Z', eventSource: 'iam.amazonaws.com', eventName: 'ListUsers', userIdentity: { userName: 'private-caller' } }, { eventVersion: '1.11', eventTime: 'bad' }] });
const file = () => new File([body], 'cloudtrail.json');
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  vi.mocked(eventFilePreviewFingerprint).mockResolvedValue(hash);
  vi.mocked(apiClient.get).mockImplementation(async url => ({ data: String(url).endsWith('/stats') ? { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } : String(url) === '/events/' ? { events: [], total: 0 } : [] }));
});
async function choose(selected: File) {
  render(<Events />); fireEvent.click(await screen.findByRole('button', { name: 'Upload events' }));
  fireEvent.change(screen.getByLabelText('Log file'), { target: { files: [selected] } });
  await screen.findByRole('button', { name: 'Upload 1 record' });
}
it('locally re-reviews a native envelope, binds its inner count and sends only explicit preview/import requests', async () => {
  const selected = file();
  vi.mocked(apiClient.post).mockImplementation(async url => ({ data: { success: true, data: String(url).endsWith('/preview') ? { format: 'onealert_event_parser_preview_v1', source_type: 'aws_cloudtrail', fingerprint: hash, byte_size: selected.size, previewed_at: '2026-11-22T06:30:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 0, skip_reasons: { invalid_timestamp: 1 }, skipped_positions: { invalid_timestamp: { record_positions: [2], omitted_positions: 0 } } } : { received: 2, ingested: 1, skipped: 1, redacted: 0, source_id: 3, skip_reasons: { invalid_timestamp: 1 } } } }));
  await choose(selected); fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'aws_cloudtrail' } });
  await screen.findByRole('button', { name: 'Upload 2 records' });
  expect(screen.getByLabelText('Selected event file review').textContent).toContain('CloudTrail Records envelope');
  expect(screen.getByLabelText('Selected event file review').textContent).not.toContain('private-caller');
  expect(screen.getByLabelText('AWS CloudTrail JSON format').textContent).toContain('No AWS credentials');
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview source parser without importing' }));
  await screen.findByLabelText('Loaded parser-preview counters'); expect(apiClient.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Upload 2 records' }));
  await screen.findByText(/All recorded counters and skip-reason counts match/);
  expect(apiClient.post).toHaveBeenCalledTimes(2);
  expect(vi.mocked(apiClient.post).mock.calls[1][2]?.params).toEqual({ source_type: 'aws_cloudtrail', preview_fingerprint: hash });
  expect((vi.mocked(apiClient.post).mock.calls[1][1] as FormData).get('file')).toBe(selected);
});
it('rejects malformed native envelopes after parser change, without offering preview or importing', async () => {
  await choose(new File(['{"Records":null}'], 'malformed.json'));
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'aws_cloudtrail' } });
  await screen.findByRole('alert'); expect(screen.queryByLabelText('Selected event file review')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Preview source parser without importing' })).toBeNull();
  expect((screen.getByRole('button', { name: /^Upload$/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('does not let a late CloudTrail local read replace a later parser review', async () => {
  const selected = file(); let reads = 0; let release!: (value: ArrayBuffer) => void;
  const bytes = new TextEncoder().encode(body).buffer;
  Object.defineProperty(selected, 'arrayBuffer', { value: () => ++reads === 2 ? new Promise<ArrayBuffer>(done => { release = done; }) : Promise.resolve(bytes) });
  await choose(selected); fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'aws_cloudtrail' } });
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByRole('status').textContent).toContain('Reading and validating');
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'zeek' } });
  await screen.findByRole('button', { name: 'Upload 1 record' });
  await act(async () => release(bytes));
  expect(screen.queryByRole('button', { name: 'Upload 2 records' })).toBeNull();
  expect(screen.getByLabelText('Selected event file review').textContent).toContain('Zeek (JSON logs)');
  expect(apiClient.post).not.toHaveBeenCalled();
});
