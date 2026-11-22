import { afterEach, expect, it, vi } from 'vitest';
import { eventFilePreviewFingerprint, eventParserPreviewJson, parseEventParserPreview } from './eventParserPreview';
const fixture = () => ({ format: 'onealert_event_parser_preview_v1', source_type: 'suricata' as const, fingerprint: 'a'.repeat(64), byte_size: 1000, previewed_at: '2026-11-22T06:30:00Z', received: 23, accepted: 0, skipped: 23, redactions_in_accepted: 0, skip_reasons: { invalid_timestamp: 23 }, skipped_positions: { invalid_timestamp: { record_positions: Array.from({ length: 10 }, (_, index) => index + 1), omitted_positions: 13 } } });
const binding = { sourceType: 'suricata', fingerprint: 'a'.repeat(64), byteSize: 1000, records: 23 };
afterEach(() => vi.unstubAllGlobals());
it('retains complete bounded counts and explicitly omitted skipped positions without importing or returning raw values', () => {
  const value = fixture(); expect(parseEventParserPreview(value, binding)).toEqual(value);
});
it.each(['source', 'fingerprint', 'bytes', 'records', 'sum', 'redactions', 'reason_sum', 'unknown_reason', 'positions', 'duplicate', 'descending', 'omitted', 'missing_positions', 'extra_positions', 'time', 'negative'])('refuses inconsistent or mismatched preview metadata: %s', mode => {
  const value = fixture();
  if (mode === 'source') value.source_type = 'zeek' as 'suricata';
  if (mode === 'fingerprint') value.fingerprint = 'b'.repeat(64);
  if (mode === 'bytes') value.byte_size++;
  if (mode === 'records') value.received++;
  if (mode === 'sum') value.accepted++;
  if (mode === 'redactions') value.redactions_in_accepted = 1;
  if (mode === 'reason_sum') value.skip_reasons.invalid_timestamp--;
  if (mode === 'unknown_reason') Object.assign(value.skip_reasons, { arbitrary_private_label: 1 });
  if (mode === 'positions') value.skipped_positions.invalid_timestamp.record_positions[0] = 24;
  if (mode === 'duplicate') value.skipped_positions.invalid_timestamp.record_positions[1] = 1;
  if (mode === 'descending') value.skipped_positions.invalid_timestamp.record_positions.reverse();
  if (mode === 'omitted') value.skipped_positions.invalid_timestamp.omitted_positions = 0;
  if (mode === 'missing_positions') Object.assign(value, { skipped_positions: {} });
  if (mode === 'extra_positions') Object.assign(value.skipped_positions, { invalid_fields: { record_positions: [12], omitted_positions: 0 } });
  if (mode === 'time') value.previewed_at = '2026-11-22T06:30:00';
  if (mode === 'negative') value.accepted = -1;
  expect(() => parseEventParserPreview(value, binding)).toThrow();
});
it('strips unknown fields at every metadata layer and exports only loaded metadata with sensitivity and non-import caveats', () => {
  const value = fixture(); Object.assign(value, { raw_data: { private: 'MUST-NOT-EXPORT' }, scope: 'MUST-NOT-EXPORT' }); Object.assign(value.skipped_positions.invalid_timestamp, { private_extra: 'MUST-NOT-EXPORT' });
  const parsed = parseEventParserPreview(value, binding), text = eventParserPreviewJson(parsed, 'input.json', '2026-11-22T06:31:00Z'), result = JSON.parse(text);
  expect(text).not.toContain('MUST-NOT-EXPORT'); expect(result.filename).toBe('input.json'); expect(result.skipped_positions.invalid_timestamp.omitted_positions).toBe(13);
  expect(result.scope).toContain('Keep private'); expect(result.scope).toContain('not imported events'); expect(result.scope).toContain('not NDJSON line numbers');
  expect(() => eventParserPreviewJson(parsed, 'input.json', 'bad')).toThrow();
});
it('binds original file bytes and parser context with the same versioned prefix and SHA-256 request', async () => {
  const digest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(10).buffer); vi.stubGlobal('crypto', { subtle: { digest } });
  const file = new File(['{"x":1}'], 'input.json'); expect(await eventFilePreviewFingerprint(file, 'suricata')).toBe('0a'.repeat(32));
  expect(digest.mock.calls[0][0]).toBe('SHA-256'); expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe('onealert_event_parser_preview_v1\0suricata\0{"x":1}');
  await eventFilePreviewFingerprint(file, 'zeek'); expect(new TextDecoder().decode(digest.mock.calls[1][1])).toContain('\0zeek\0');
});
it('fails closed without secure hashing support or a supported bounded file', async () => {
  vi.stubGlobal('crypto', {}); await expect(eventFilePreviewFingerprint(new File(['{}'], 'input.json'), 'suricata')).rejects.toThrow('No preview or import');
  await expect(eventFilePreviewFingerprint(new File([], 'input.json'), 'suricata')).rejects.toThrow();
  await expect(eventFilePreviewFingerprint(new File(['{}'], 'input.json'), 'unknown')).rejects.toThrow();
});

it('validates and exports the explicit Windows parser without accepting another parser binding', () => {
  const value = { ...fixture(), source_type: 'windows_security' };
  const parsed = parseEventParserPreview(value, { ...binding, sourceType: 'windows_security' });
  expect(parsed.source_type).toBe('windows_security'); expect(JSON.parse(eventParserPreviewJson(parsed, 'windows.ndjson', '2026-11-22T06:31:00Z')).source_type).toBe('windows_security');
  expect(() => parseEventParserPreview(value, binding)).toThrow();
});
it('binds Windows bytes to its own parser context and rejects inherited object keys as parser names', async () => {
  const digest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(10).buffer); vi.stubGlobal('crypto', { subtle: { digest } });
  await eventFilePreviewFingerprint(new File(['{}'], 'windows.json'), 'windows_security'); expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe('onealert_event_parser_preview_v1\0windows_security\0{}');
  for (const parser of ['constructor', '__proto__', 'toString']) {
    await expect(eventFilePreviewFingerprint(new File(['{}'], 'windows.json'), parser)).rejects.toThrow();
    expect(() => parseEventParserPreview({ ...fixture(), source_type: parser }, { ...binding, sourceType: parser })).toThrow();
  }
});

it('validates and exports the explicit Linux journal parser without accepting another parser binding', () => {
  const value = { ...fixture(), source_type: 'linux_journal' };
  const parsed = parseEventParserPreview(value, { ...binding, sourceType: 'linux_journal' });
  expect(parsed.source_type).toBe('linux_journal'); expect(JSON.parse(eventParserPreviewJson(parsed, 'journal.ndjson', '2026-11-22T06:31:00Z')).source_type).toBe('linux_journal');
  expect(() => parseEventParserPreview(value, binding)).toThrow();
});
it('binds Linux journal bytes to its own parser context and rejects inherited object keys as parser names', async () => {
  const digest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(10).buffer); vi.stubGlobal('crypto', { subtle: { digest } });
  await eventFilePreviewFingerprint(new File(['{}'], 'journal.json'), 'linux_journal'); expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe('onealert_event_parser_preview_v1\0linux_journal\0{}');
  for (const parser of ['constructor', '__proto__', 'toString']) {
    await expect(eventFilePreviewFingerprint(new File(['{}'], 'journal.json'), parser)).rejects.toThrow();
    expect(() => parseEventParserPreview({ ...fixture(), source_type: parser }, { ...binding, sourceType: parser })).toThrow();
  }
});

it('binds the complete native CloudTrail bytes to its explicit parser and exports only matching preview metadata', async () => {
  const value = { ...fixture(), source_type: 'aws_cloudtrail' };
  const parsed = parseEventParserPreview(value, { ...binding, sourceType: 'aws_cloudtrail' });
  expect(JSON.parse(eventParserPreviewJson(parsed, 'trail.json', '2026-11-22T06:31:00Z')).source_type).toBe('aws_cloudtrail');
  expect(() => parseEventParserPreview(value, binding)).toThrow();
  const digest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(10).buffer); vi.stubGlobal('crypto', { subtle: { digest } });
  await eventFilePreviewFingerprint(new File(['{"Records":[{}]}'], 'trail.json'), 'aws_cloudtrail');
  expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe('onealert_event_parser_preview_v1\0aws_cloudtrail\0{"Records":[{}]}');
});
