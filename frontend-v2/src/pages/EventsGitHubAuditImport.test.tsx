import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Events } from './Events';
import apiClient from '../api/client';
import { eventFilePreviewFingerprint } from '../utils/eventParserPreview';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../utils/eventParserPreview', async original => ({ ...await original<typeof import('../utils/eventParserPreview')>(), eventFilePreviewFingerprint: vi.fn() }));
const post = vi.mocked(apiClient.post), hash = 'e'.repeat(64);
const file = new File(['[{"created_at":1767225600123,"action":"team.create","actor":"PRIVATE_ACTOR","org":"synthetic"},{}]'], 'audit.json');
const counters = (extra = {}) => ({ format: 'onealert_event_parser_preview_v1', source_type: 'github_audit', fingerprint: hash, byte_size: file.size, previewed_at: '2026-11-22T12:00:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 0, skip_reasons: { unsupported_record: 1 }, skipped_positions: { unsupported_record: { record_positions: [2], omitted_positions: 0 } }, ...extra });
const previewButton = () => screen.getByRole('button', { name: 'Preview source parser without importing' });
const uploadButton = () => screen.getByRole('button', { name: 'Upload 2 records' }) as HTMLButtonElement;
async function choose() {
  render(<Events />); fireEvent.click(await screen.findByRole('button', { name: 'Upload events' }));
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'github_audit' } });
  fireEvent.change(screen.getByLabelText('Log file'), { target: { files: [file] } }); await screen.findByRole('button', { name: 'Upload 2 records' });
}
beforeEach(() => {
  vi.mocked(apiClient.get).mockImplementation(async url => ({ data: url === '/events/' ? { events: [], total: 0 } : url === '/events/stats' ? { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } : url === '/events/types' ? { types: [] } : [] }));
  vi.mocked(eventFilePreviewFingerprint).mockResolvedValue(hash);
  post.mockImplementation(async url => ({ data: { success: true, data: url === '/events/upload/preview' ? counters() : { received: 2, ingested: 1, skipped: 1, redacted: 0, source_id: 4, skip_reasons: { unsupported_record: 1 } } } }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('explains native millisecond time, actor versus target, partial-file and privacy boundaries without a request', async () => {
  await choose(); const help = screen.getByLabelText('GitHub audit JSON format');
  expect(help.textContent).toContain('milliseconds since the UTC Unix epoch'); expect(help.textContent).toContain('Only the direct actor field'); expect(help.textContent).toContain('not authenticated GitHub evidence'); expect(help.textContent).toContain('No GitHub token');
  fireEvent.click(screen.getByText('Show synthetic GitHub audit JSON example')); expect(screen.getByText(/Format example only, not observed evidence/)).toBeTruthy();
  expect(screen.getByLabelText('Selected event file review').textContent).toContain('GitHub audit (JSON records)'); expect(document.body.textContent).not.toContain('PRIVATE_ACTOR'); expect(post).not.toHaveBeenCalled();
});
it('previews once and imports only explicitly with the exact original file and matching audit binding', async () => {
  await choose(); fireEvent.click(previewButton()); await screen.findByLabelText('Loaded parser-preview counters');
  expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0][2]?.params).toEqual({ source_type: 'github_audit' }); expect((post.mock.calls[0][1] as FormData).get('file')).toBe(file);
  fireEvent.click(uploadButton()); await screen.findByText(/All recorded counters and skip-reason counts match/);
  expect(post).toHaveBeenCalledTimes(2); expect(post.mock.calls[1][2]?.params).toEqual({ source_type: 'github_audit', preview_fingerprint: hash }); expect((post.mock.calls[1][1] as FormData).get('file')).toBe(file);
});
it('clears loaded audit counters on parser changes without previewing again', async () => {
  await choose(); fireEvent.click(previewButton()); await screen.findByLabelText('Loaded parser-preview counters');
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'entra_signin' } }); await screen.findByRole('button', { name: 'Upload 2 records' }); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull();
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'github_audit' } }); await screen.findByRole('button', { name: 'Upload 2 records' }); expect(post).toHaveBeenCalledTimes(1);
});
it('does not inherit a native CloudTrail envelope count or preview when switching to audit', async () => {
  await choose(); const trail = new File(['{"Records":[{},{}]}'], 'trail.json');
  fireEvent.change(screen.getByLabelText('Log file'), { target: { files: [trail] } }); await screen.findByRole('button', { name: 'Upload 1 record' });
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'aws_cloudtrail' } }); await screen.findByRole('button', { name: 'Upload 2 records' });
  post.mockResolvedValueOnce({ data: { success: true, data: counters({ source_type: 'aws_cloudtrail', byte_size: trail.size }) } }); fireEvent.click(previewButton()); await screen.findByLabelText('Loaded parser-preview counters');
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'github_audit' } }); await screen.findByRole('button', { name: 'Upload 1 record' }); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
it('blocks zero acceptance and mismatched parser replies, and keeps private errors generic', async () => {
  await choose(); post.mockResolvedValueOnce({ data: { success: true, data: counters({ accepted: 0, skipped: 2, skip_reasons: { unsupported_record: 2 }, skipped_positions: { unsupported_record: { record_positions: [1, 2], omitted_positions: 0 } } }) } });
  fireEvent.click(previewButton()); await screen.findByLabelText('Loaded parser-preview counters'); expect(uploadButton().disabled).toBe(true); fireEvent.submit(uploadButton().closest('form')!); expect(post).toHaveBeenCalledTimes(1);
  post.mockResolvedValueOnce({ data: { success: true, data: counters({ source_type: 'entra_signin' }) } }); fireEvent.click(previewButton()); await screen.findByText(/Parser preview could not be verified/); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull();
  post.mockRejectedValueOnce(new Error('PRIVATE_ERROR')); fireEvent.click(previewButton()); await waitFor(() => expect(post).toHaveBeenCalledTimes(3)); await screen.findByText(/Parser preview could not be verified/); expect(document.body.textContent).not.toContain('PRIVATE_ERROR');
});
it('discards pending audit preview after parser context changes without an automatic retry', async () => {
  let resolve!: (value: unknown) => void;
  await choose(); post.mockReturnValueOnce(new Promise(done => { resolve = done; })); fireEvent.click(previewButton()); await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(uploadButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'zeek' } }); await waitFor(() => expect(uploadButton().disabled).toBe(false));
  await act(async () => resolve({ data: { success: true, data: counters() } })); expect(screen.queryByLabelText('Loaded parser-preview counters')).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
});
