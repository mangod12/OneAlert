/// <reference types="node" />
import { gzipSync } from 'node:zlib';
import { DecompressionStream, ReadableStream, TransformStream } from 'node:stream/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { expandEventGzip } from './eventGzip';
import { MAX_EVENT_FILE_BYTES, reviewEventFile } from './eventFileReview';
const plain = JSON.stringify({ Records: [{ eventVersion: '1.11', privateField: 'NEVER_SAMPLE' }, { eventTime: 'bad' }] });
const bytes = (text = plain) => Uint8Array.from(gzipSync(text));
const file = (data = bytes()) => new File([data], 'native.json.gz');
beforeEach(() => { vi.stubGlobal('ReadableStream', ReadableStream); vi.stubGlobal('DecompressionStream', DecompressionStream); });
afterEach(() => vi.unstubAllGlobals());
it('reviews native gzip locally with inner counts, names only and exact expanded bytes', async () => {
  const result = await reviewEventFile(file(), 'aws_cloudtrail');
  expect(result).toEqual({ format: 'Gzip / CloudTrail Records envelope', records: 2, sampleFields: ['eventVersion', 'privateField', 'eventTime'], decodedByteSize: new TextEncoder().encode(plain).byteLength });
  expect(JSON.stringify(result)).not.toContain('NEVER_SAMPLE');
});
it.each(['suricata', 'zeek', 'linux_journal', 'windows_security', ''])('does not guess gzip for another parser: %s', async parser => {
  await expect(reviewEventFile(file(), parser)).rejects.toThrow('requires the AWS CloudTrail parser');
});
it('does not trust gzip extensions or MIME types over actual bytes', async () => {
  await expect(reviewEventFile(new File(['{}'], 'not-gzip.json.gz', { type: 'application/gzip' }), 'aws_cloudtrail')).resolves.toEqual({ format: 'JSON object', records: 1, sampleFields: [] });
  const result = await reviewEventFile(new File([bytes()], 'arbitrary.json'), 'aws_cloudtrail');
  expect(result.records).toBe(2); expect(result.decodedByteSize).toBeGreaterThan(0);
});
it('fails closed without native decompression and offers local unzip rather than transmission', async () => {
  vi.stubGlobal('DecompressionStream', undefined);
  await expect(reviewEventFile(file(), 'aws_cloudtrail')).rejects.toThrow('Unzip the file first');
});
it.each(['truncated', 'crc', 'length'])('rejects damaged gzip with private decoder errors hidden: %s', async mode => {
  let compressed = bytes();
  if (mode === 'truncated') compressed = compressed.slice(0, -1);
  else compressed[compressed.length - (mode === 'crc' ? 8 : 1)] ^= 1;
  await expect(reviewEventFile(file(compressed), 'aws_cloudtrail')).rejects.toThrow('incomplete, corrupt or unsupported');
});
it('stops expansion above the byte budget before JSON review', async () => {
  const compressed = file(bytes(' '.repeat(MAX_EVENT_FILE_BYTES + 1)));
  expect(compressed.size).toBeLessThan(20000);
  await expect(reviewEventFile(compressed, 'aws_cloudtrail')).rejects.toThrow('Expanded event file exceeds the 10 MiB limit');
});
it('feeds at most 256 compressed bytes per stream chunk and enforces the reader budget', async () => {
  const sizes: number[] = [];
  vi.stubGlobal('DecompressionStream', class { constructor() { return new TransformStream({ transform(value: Uint8Array, controller) { sizes.push(value.byteLength); controller.enqueue(value); } }); } });
  const input = new Uint8Array(1025).buffer;
  expect((await expandEventGzip(input, 2000)).byteLength).toBe(1025);
  expect(Math.max(...sizes)).toBe(256);
  expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(1025);
  await expect(expandEventGzip(input, 1000)).rejects.toThrow('Expanded event file exceeds');
});
it.each(['{"Records":[]}', '{"Records":[null]}', '{"Records":{},"extra":1}', '[{},false]', 'not json'])('still rejects malformed JSON envelopes after inflation', async text => {
  await expect(reviewEventFile(file(bytes(text)), 'aws_cloudtrail')).rejects.toThrow();
});
it('retains expanded record limits and strict UTF-8 decoding', async () => {
  await expect(reviewEventFile(file(bytes(JSON.stringify({ Records: Array(50001).fill({}) }))), 'aws_cloudtrail')).rejects.toThrow('50,000');
  await expect(reviewEventFile(file(Uint8Array.from(gzipSync(new Uint8Array([255])))), 'aws_cloudtrail')).rejects.toThrow('UTF-8');
});

it('accepts the exact expanded byte limit without truncating JSON', async () => {
  const padded = plain + ' '.repeat(MAX_EVENT_FILE_BYTES - new TextEncoder().encode(plain).byteLength);
  const result = await reviewEventFile(file(bytes(padded)), 'aws_cloudtrail');
  expect(result.records).toBe(2); expect(result.decodedByteSize).toBe(MAX_EVENT_FILE_BYTES);
});
