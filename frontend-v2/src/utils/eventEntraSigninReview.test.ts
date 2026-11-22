import { afterEach, expect, it, vi } from 'vitest';
import { MAX_EVENT_FILE_BYTES, reviewEventFile, reviewEventText } from './eventFileReview';
import { eventFilePreviewFingerprint, eventParserPreviewJson, parseEventParserPreview } from './eventParserPreview';

const envelope = () => ({ '@odata.context': 'synthetic-context', '@odata.nextLink': 'https://example.invalid/PRIVATE_CURSOR', value: [{ id: 'first', private: 'PRIVATE_VALUE' }, { id: 'second' }] });
afterEach(() => vi.unstubAllGlobals());

it('reviews only supplied value records, with explicit page scope and no continuation or raw values returned', () => {
  const reviewed = reviewEventText(JSON.stringify(envelope()), 'entra_signin');
  expect(reviewed.records).toBe(2); expect(reviewed.format).toContain('supplied page only; continuation not followed');
  expect(reviewed.sampleFields).toEqual(['id', 'private']);
  expect(JSON.stringify(reviewed)).not.toMatch(/PRIVATE_CURSOR|PRIVATE_VALUE|example.invalid/);
});
it.each(['', 'suricata', 'zeek', 'windows_security', 'linux_journal', 'aws_cloudtrail'])('does not unwrap a generic value envelope with parser %s', parser => {
  expect(reviewEventText(JSON.stringify(envelope()), parser).records).toBe(1);
});
it.each([{}, { '@odata.context': 'context' }, { '@odata.nextLink': 'https://example.invalid/PRIVATE_CURSOR' }])('permits exactly the documented optional text metadata: %o', metadata => {
  expect(reviewEventText(JSON.stringify({ ...metadata, value: [{}] }), 'entra_signin').records).toBe(1);
});
it.each([
  { value: [] }, { value: null }, { value: {} }, { value: [null] }, { value: ['{}'] },
  { value: [{}], extra: 'PRIVATE_VALUE' }, { value: [{}], '@odata.count': 1 },
  { value: [{}], '@odata.context': null }, { value: [{}], '@odata.context': [] },
  { value: [{}], '@odata.nextLink': {} }, { value: [{}], '@odata.nextLink': '' }, { value: [{}], '@odata.nextLink': ' ' },
])('rejects ambiguous, empty or unsupported value wrappers without echoing metadata: %o', input => {
  expect(() => reviewEventText(JSON.stringify(input), 'entra_signin')).toThrow();
  try { reviewEventText(JSON.stringify(input), 'entra_signin'); } catch (error) { expect(String(error)).not.toContain('PRIVATE_VALUE'); }
});
it('keeps 50,000-record and nesting bounds after extracting a native page, without recursively unpacking', () => {
  expect(reviewEventText(JSON.stringify({ value: Array(50_000).fill({}) }), 'entra_signin').records).toBe(50_000);
  expect(() => reviewEventText(JSON.stringify({ value: Array(50_001).fill({}) }), 'entra_signin')).toThrow('50,000');
  expect(() => reviewEventText('{"value":[' + '{"x":'.repeat(64) + '{}' + '}'.repeat(64) + ']}', 'entra_signin')).toThrow('64 levels');
  expect(reviewEventText(JSON.stringify({ value: [envelope()] }), 'entra_signin').records).toBe(1);
});
it('supports plain object, array and NDJSON without silently decoding nested strings', () => {
  for (const text of ['{"id":"one"}', '[{"id":"one"}]', '{"id":"one"}\n{"id":"two"}\n']) expect(reviewEventText(text, 'entra_signin').records).toBe(text.includes('\n') ? 2 : 1);
  expect(() => reviewEventText('"encoded record"', 'entra_signin')).toThrow();
});
it('keeps UTF-8 and byte bounds, and does not enable CloudTrail gzip expansion for Entra', async () => {
  const read = vi.fn();
  await expect(reviewEventFile({ size: MAX_EVENT_FILE_BYTES + 1, arrayBuffer: read } as unknown as File, 'entra_signin')).rejects.toThrow('10 MiB'); expect(read).not.toHaveBeenCalled();
  await expect(reviewEventFile(new File([new Uint8Array([255, 123, 125])], 'invalid.json'), 'entra_signin')).rejects.toThrow('UTF-8');
  await expect(reviewEventFile(new File([new Uint8Array([31, 139, 0, 0])], 'signin.json.gz'), 'entra_signin')).rejects.toThrow('Gzip input requires the AWS CloudTrail parser');
});
it('binds complete original envelope bytes to the new parser and strictly projects matching preview metadata', async () => {
  const digest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(10).buffer); vi.stubGlobal('crypto', { subtle: { digest } });
  const body = JSON.stringify(envelope()), file = new File([body], 'signin.json');
  const fingerprint = await eventFilePreviewFingerprint(file, 'entra_signin');
  expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe('onealert_event_parser_preview_v1\0entra_signin\0' + body);
  const data = { format: 'onealert_event_parser_preview_v1', source_type: 'entra_signin', fingerprint, byte_size: file.size, previewed_at: '2026-11-22T12:00:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 0, skip_reasons: { invalid_timestamp: 1 }, skipped_positions: { invalid_timestamp: { record_positions: [2], omitted_positions: 0 } }, raw_data: envelope() };
  const checked = parseEventParserPreview(data, { sourceType: 'entra_signin', fingerprint, byteSize: file.size, records: 2 });
  const text = eventParserPreviewJson(checked, 'signin.json', '2026-11-22T12:01:00Z');
  expect(JSON.parse(text).source_type).toBe('entra_signin'); expect(text).not.toMatch(/PRIVATE_CURSOR|PRIVATE_VALUE|raw_data/);
  expect(() => parseEventParserPreview(data, { sourceType: 'aws_cloudtrail', fingerprint, byteSize: file.size, records: 2 })).toThrow();
});
