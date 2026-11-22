import { afterEach, expect, it, vi } from 'vitest';
import { eventFilePreviewFingerprint, eventParserPreviewJson, parseEventParserPreview } from './eventParserPreview';
import { reviewEventFile, reviewEventText } from './eventFileReview';

afterEach(() => vi.unstubAllGlobals());
it('reviews native audit object, array and NDJSON without converting source milliseconds or actor IDs', async () => {
  const raw = '{"created_at":1767225600123,"actor_id":9007199254740993,"org":"synthetic","action":"repo.create"}';
  expect(reviewEventText(raw, 'github_audit').records).toBe(1);
  expect(reviewEventText('[' + raw + ',' + raw + ']', 'github_audit').records).toBe(2);
  expect(reviewEventText(raw + '\n' + raw, 'github_audit').records).toBe(2);
  const file = new File([raw], 'audit.json'); const bytes = vi.fn().mockResolvedValue(new TextEncoder().encode(raw).buffer); Object.defineProperty(file, 'arrayBuffer', { value: bytes });
  expect((await reviewEventFile(file, 'github_audit')).sampleFields).toEqual(['created_at', 'actor_id', 'org', 'action']);
  const digest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(10).buffer); vi.stubGlobal('crypto', { subtle: { digest } });
  await eventFilePreviewFingerprint(file, 'github_audit'); expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe('onealert_event_parser_preview_v1\0github_audit\0' + raw);
});
it('does not enable other providers native wrappers or gzip for GitHub audit', async () => {
  for (const wrapper of [{ value: [{}, {}] }, { Records: [{}, {}] }, { edges: [{ node: {} }] }]) expect(reviewEventText(JSON.stringify(wrapper), 'github_audit').records).toBe(1);
  await expect(reviewEventFile(new File([new Uint8Array([31, 139, 0, 0])], 'audit.json.gz'), 'github_audit')).rejects.toThrow('Gzip input requires the AWS CloudTrail parser');
});
it('validates only matching audit preview metadata and excludes raw identities and unknown fields from downloads', () => {
  const data = { format: 'onealert_event_parser_preview_v1', source_type: 'github_audit', fingerprint: 'a'.repeat(64), byte_size: 100, previewed_at: '2026-11-22T12:00:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 1, skip_reasons: { invalid_timestamp: 1 }, skipped_positions: { invalid_timestamp: { record_positions: [2], omitted_positions: 0 } }, raw_data: { actor: 'PRIVATE_ACTOR' }, scope: 'PRIVATE_SCOPE' };
  const binding = { sourceType: 'github_audit', fingerprint: data.fingerprint, byteSize: 100, records: 2 };
  const checked = parseEventParserPreview(data, binding), text = eventParserPreviewJson(checked, 'audit.json', '2026-11-22T12:01:00Z');
  expect(JSON.parse(text).source_type).toBe('github_audit'); expect(text).not.toMatch(/PRIVATE_ACTOR|PRIVATE_SCOPE|raw_data/);
  expect(() => parseEventParserPreview(data, { ...binding, sourceType: 'entra_signin' })).toThrow();
});
