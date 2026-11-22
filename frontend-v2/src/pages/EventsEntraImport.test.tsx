import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Events } from './Events';
import apiClient from '../api/client';
import { eventFilePreviewFingerprint } from '../utils/eventParserPreview';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../utils/eventParserPreview', async original => ({ ...await original<typeof import('../utils/eventParserPreview')>(), eventFilePreviewFingerprint: vi.fn() }));
const post = vi.mocked(apiClient.post), hash = 'd'.repeat(64);
const file = new File([JSON.stringify({ '@odata.nextLink': 'https://example.invalid/PRIVATE_CURSOR', value: [{ id: 'first' }, { id: 'second' }] })], 'signin.json');
const counters = (extra = {}) => ({ format: 'onealert_event_parser_preview_v1', source_type: 'entra_signin', fingerprint: hash, byte_size: file.size, previewed_at: '2026-11-22T12:00:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 0, skip_reasons: { invalid_timestamp: 1 }, skipped_positions: { invalid_timestamp: { record_positions: [2], omitted_positions: 0 } }, ...extra });
const previewButton = () => screen.getByRole('button', { name: 'Preview source parser without importing' });
const uploadButton = () => screen.getByRole('button', { name: 'Upload 2 records' }) as HTMLButtonElement;
async function choose() {
  render(<Events />); fireEvent.click(await screen.findByRole('button', { name: 'Upload events' }));
  fireEvent.change(screen.getByLabelText('Log file'), { target: { files: [file] } }); await screen.findByRole('button', { name: 'Upload 1 record' });
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'entra_signin' } }); await screen.findByRole('button', { name: 'Upload 2 records' });
}
beforeEach(() => {
  vi.mocked(apiClient.get).mockImplementation(async url => ({ data: url === '/events/' ? { events: [], total: 0 } : url === '/events/stats' ? { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } : url === '/events/types' ? { types: [] } : [] }));
  vi.mocked(eventFilePreviewFingerprint).mockResolvedValue(hash);
  post.mockImplementation(async url => ({ data: { success: true, data: url === '/events/upload/preview' ? counters() : { received: 2, ingested: 1, skipped: 1, redacted: 0, source_id: 4, skip_reasons: { invalid_timestamp: 1 } } } }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('re-reviews the native envelope locally and explains supplied-page, privacy and non-verdict boundaries without posting', async () => {
  await choose();
  const review = screen.getByLabelText('Selected event file review'); expect(review.textContent).toContain('2 JSON records'); expect(review.textContent).toContain('supplied page only; continuation not followed'); expect(review.textContent).toContain('Microsoft Entra sign-in (Graph JSON)');
  const help = screen.getByLabelText('Microsoft Entra sign-in JSON format'); expect(help.textContent).toContain('not a complete tenant-history check'); expect(help.textContent).toContain('No Microsoft credentials'); expect(help.textContent).toContain('not a verified authentication');
  fireEvent.click(screen.getByText('Show synthetic Entra sign-in JSON example')); expect(screen.getByText(/Format example only, not observed evidence/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('PRIVATE_CURSOR'); expect(post).not.toHaveBeenCalled();
});
it('previews once and imports only explicitly with the exact original File and loaded parser binding', async () => {
  await choose(); fireEvent.click(previewButton()); await screen.findByLabelText('Loaded parser-preview counters');
  expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0][2]?.params).toEqual({ source_type: 'entra_signin' }); expect((post.mock.calls[0][1] as FormData).get('file')).toBe(file);
  fireEvent.click(uploadButton()); await screen.findByText(/All recorded counters and skip-reason counts match/);
  expect(post).toHaveBeenCalledTimes(2); expect(post.mock.calls[1][2]?.params).toEqual({ source_type: 'entra_signin', preview_fingerprint: hash }); expect((post.mock.calls[1][1] as FormData).get('file')).toBe(file);
});
it('re-reviews to one wrapper record on leaving and back to two on returning, with no automatic preview or import', async () => {
  await choose(); fireEvent.click(previewButton()); await screen.findByLabelText('Loaded parser-preview counters');
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'aws_cloudtrail' } }); await screen.findByRole('button', { name: 'Upload 1 record' }); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull();
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'entra_signin' } }); await screen.findByRole('button', { name: 'Upload 2 records' }); expect(post).toHaveBeenCalledTimes(1);
});
it('blocks zero-accepted records, mismatched parser replies and private errors without automatic retries', async () => {
  await choose(); post.mockResolvedValueOnce({ data: { success: true, data: counters({ accepted: 0, skipped: 2, skip_reasons: { invalid_timestamp: 2 }, skipped_positions: { invalid_timestamp: { record_positions: [1, 2], omitted_positions: 0 } } }) } });
  fireEvent.click(previewButton()); await screen.findByLabelText('Loaded parser-preview counters'); expect(uploadButton().disabled).toBe(true); fireEvent.submit(uploadButton().closest('form')!); expect(post).toHaveBeenCalledTimes(1);
  post.mockResolvedValueOnce({ data: { success: true, data: counters({ source_type: 'aws_cloudtrail' }) } }); fireEvent.click(previewButton()); await screen.findByText(/Parser preview could not be verified/); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull();
  post.mockRejectedValueOnce(new Error('PRIVATE_ERROR')); fireEvent.click(previewButton()); await waitFor(() => expect(post).toHaveBeenCalledTimes(3)); await screen.findByText(/Parser preview could not be verified/); expect(document.body.textContent).not.toContain('PRIVATE_ERROR');
});
it('discards a pending Entra preview after parser context changes and re-reviews without sending again', async () => {
  let resolve!: (value: unknown) => void;
  await choose(); post.mockReturnValueOnce(new Promise(done => { resolve = done; })); fireEvent.click(previewButton()); await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(uploadButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'zeek' } }); await screen.findByRole('button', { name: 'Upload 1 record' });
  await act(async () => resolve({ data: { success: true, data: counters() } })); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
it('rejects unsupported wrapper fields locally and does not transmit any file', async () => {
  await choose(); const bad = new File([JSON.stringify({ value: [{}], extra: 'PRIVATE_VALUE' })], 'bad.json');
  fireEvent.change(screen.getByLabelText('Log file'), { target: { files: [bad] } }); await screen.findByText(/Entra sign-in envelope requires a value array/);
  expect(screen.queryByLabelText('Selected event file review')).toBeNull(); expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true); expect(document.body.textContent).not.toContain('PRIVATE_VALUE'); expect(post).not.toHaveBeenCalled();
});
