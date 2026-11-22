import { expect, it } from 'vitest';
import { compareImportPreview, compareImportReceipt, importReceiptDownload, snapshotImportPreview } from './eventImportComparison';
import type { ImportReceipt } from './eventImportReceipt';
const file = new File(['[{},{}]'], 'input.json');
const preview = () => ({ format: 'onealert_event_parser_preview_v1', source_type: 'windows_security' as const, fingerprint: 'a'.repeat(64), byte_size: file.size, previewed_at: '2026-11-22T06:30:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 2, skip_reasons: { invalid_timestamp: 1 }, skipped_positions: { invalid_timestamp: { record_positions: [2], omitted_positions: 0 } } });
const actual = () => ({ received: 2, ingested: 1, skipped: 1, redacted: 2, source_id: 9, skip_reasons: { invalid_timestamp: 1 } });
it('compares all four counters and finite reason counts without treating metadata matches as live evidence', () => {
  const result = compareImportPreview(preview(), 'windows_security', actual());
  expect(result.status).toBe('matching'); expect(result.counters).toHaveLength(4); expect(result.counters.every(row => row.delta === 0)).toBe(true);
  expect(result.reasons).toEqual([{ key: 'invalid_timestamp', label: 'Missing, invalid or ambiguous recorded timestamp', preview: 1, actual: 1, delta: 0 }]);
});
it('does not invent an attached preview for legacy imports', () => { expect(compareImportPreview(undefined, 'suricata', actual()).status).toBe('not_attached'); expect(snapshotImportPreview(undefined, file, 'suricata')).toBeUndefined(); });
it.each(['redacted', 'received', 'ingested', 'skipped'])('keeps missing %s unknown, never zero or a matching outcome', key => {
  const data: Record<string, unknown> = actual(); delete data[key]; const result = compareImportPreview(preview(), 'windows_security', data);
  expect(result.status).toBe('incomplete'); const row = result.counters.find(row => row.key === key)!; expect(row.actual).toBeUndefined(); expect(row.delta).toBeUndefined();
});
it('detects redaction differences even when accepted and skipped rows match', () => { expect(compareImportPreview(preview(), 'windows_security', { ...actual(), redacted: 3 }).status).toBe('different'); });
it('detects different reason distributions even when every total matches', () => {
  const result = compareImportPreview(preview(), 'windows_security', { ...actual(), skip_reasons: { invalid_fields: 1 } });
  expect(result.status).toBe('different'); expect(result.reasons.map(row => row.delta)).toEqual([1, -1]);
});
it('treats an explicit exhaustive zero-reason map as zero only after checking actual skipped counts', () => {
  const source = { ...preview(), accepted: 2, skipped: 0, skip_reasons: {}, skipped_positions: {} };
  expect(compareImportPreview(source, 'windows_security', { received: 2, ingested: 2, skipped: 0, redacted: 2, skip_reasons: {} }).status).toBe('matching');
  expect(compareImportPreview(source, 'windows_security', { received: 2, ingested: 2, skipped: 0, redacted: 2 }).status).toBe('incomplete');
});
it.each([{ received: 3 }, { received: 50001 }, { skip_reasons: [] }, { skip_reasons: { invalid_fields: 2 } }, { skip_reasons: { PRIVATE_REASON: 1 } }, { skip_reasons: { invalid_timestamp: -1 } }])('rejects contradictory or non-enumerated actual metadata %j', extra => {
  const result = compareImportPreview(preview(), 'windows_security', { ...actual(), ...extra }); expect(result.status).toBe('unverifiable'); expect(result.reasons).toEqual([]);
});
it.each([null, {}, { ...preview(), source_type: 'zeek' }, { ...preview(), fingerprint: 'wrong' }, { ...preview(), accepted: 4 }])('rejects invalid or other-parser preview metadata', value => { const result = compareImportPreview(value, 'windows_security', actual()); expect(result.status).toBe('unverifiable'); expect(result.preview).toBeNull(); });
it('snapshots through allowlists and copies nested arrays before any awaited import', () => {
  const original = { ...preview(), raw_data: 'PRIVATE_RAW' }, snapshot = snapshotImportPreview(original, file, 'windows_security')!;
  original.skipped_positions.invalid_timestamp.record_positions[0] = 1;
  expect(snapshot.skipped_positions.invalid_timestamp.record_positions).toEqual([2]); expect(snapshot).not.toHaveProperty('raw_data');
  expect(() => snapshotImportPreview(preview(), new File(['{}'], file.name), 'windows_security')).toThrow(); expect(() => snapshotImportPreview(preview(), file, 'suricata')).toThrow();
});
it('exports allowlisted actual and attached preview context, not whole raw objects or unknown labels', () => {
  const receipt: ImportReceipt = { filename: file.name, parser: 'windows_security', received_at: '2026-11-22T06:31:00Z', result: { ...actual(), raw_data: 'PRIVATE_ACTUAL' } as ReturnType<typeof actual>, parser_preview: { ...preview(), raw_data: 'PRIVATE_PREVIEW' } as ReturnType<typeof preview> };
  const text = importReceiptDownload(receipt), data = JSON.parse(text);
  expect(text).not.toContain('PRIVATE_'); expect(data.preview_comparison.status).toBe('matching'); expect(data.preview_comparison.attached_request_preview.fingerprint).toBe(preview().fingerprint);
  expect(data.preview_comparison.scope).toContain('Missing counters are not zero'); expect(data.scope).toContain('Keep private'); expect(data.result).toEqual(actual());
});
it('keeps legacy receipt JSON format and omits a nonexistent comparison', () => {
  const body = JSON.parse(importReceiptDownload({ filename: file.name, parser: 'suricata', received_at: '2026-11-22T06:31:00Z', result: actual() }));
  expect(body.format).toBe('onealert_event_import_receipt_v1'); expect(body).not.toHaveProperty('preview_comparison');
});

it('preserves raw-response rejection after private unknown fields have been stripped', () => {
  const receipt: ImportReceipt = { filename: file.name, parser: 'windows_security', received_at: '2026-11-22T06:31:00Z', result: actual(), parser_preview: preview(), preview_response_unverifiable: true };
  expect(compareImportReceipt(receipt).status).toBe('unverifiable'); expect(JSON.parse(importReceiptDownload(receipt)).preview_comparison.status).toBe('unverifiable');
});
it('blocks a known zero-accepted attached preview before an upload can be requested', () => {
  const zero = { ...preview(), accepted: 0, skipped: 2, redactions_in_accepted: 0, skip_reasons: { invalid_timestamp: 2 }, skipped_positions: { invalid_timestamp: { record_positions: [1, 2], omitted_positions: 0 } } };
  expect(() => snapshotImportPreview(zero, file, 'windows_security')).toThrow('No import was requested');
});
