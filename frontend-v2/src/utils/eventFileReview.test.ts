import { describe, expect, it, vi } from 'vitest';
import { MAX_EVENT_FILE_BYTES, reviewEventFile, reviewEventText } from './eventFileReview';

describe('Local event JSON review', () => {
  it.each([
    ['{"event_type":"alert"}', 'JSON object', 1],
    ['[{"id":1},{"id":2}]', 'JSON array', 2],
    ['\uFEFF{"id":1}\r\n\n{"id":2}\r\n', 'Newline-delimited JSON', 2],
  ])('reviews an envelope without transforming its records', (text, format, count) => {
    const result = reviewEventText(String(text));
    expect(result.format).toBe(format);
    expect(result.records).toBe(count);
    expect(result.sampleFields.length).toBeGreaterThan(0);
  });

  it.each(['', '[]', 'null', 'false', '1', '[{},null]', '{}\nbroken\n{}', '{}\n[]', '{"x": NaN}', '\uFEFF\uFEFF{}'])('rejects the whole invalid envelope: %s', text => {
    expect(() => reviewEventText(text)).toThrow();
  });

  it('reports the malformed physical line rather than silently skipping it', () => {
    expect(() => reviewEventText('{}\n\nbroken\n{}')).toThrow('line 3');
  });

  it('enforces the same 50,000 record cap for arrays and newline-delimited JSON', () => {
    expect(reviewEventText('{}\n'.repeat(50_000)).records).toBe(50_000);
    expect(() => reviewEventText('{}\n'.repeat(50_001))).toThrow('50,000');
    expect(() => reviewEventText(JSON.stringify(Array(50_001).fill({})))).toThrow('50,000');
  });

  it('checks size before reading and reports read errors', async () => {
    const bytes = vi.fn();
    const big = { size: MAX_EVENT_FILE_BYTES + 1, arrayBuffer: bytes } as unknown as File;
    await expect(reviewEventFile(big)).rejects.toThrow('10 MiB');
    expect(bytes).not.toHaveBeenCalled();
    await expect(reviewEventFile({ size: 3, arrayBuffer: vi.fn().mockRejectedValue(new Error('read failed')) } as unknown as File)).rejects.toThrow('could not be read');
  });

  it('strictly decodes UTF-8, permits one BOM, and rejects a second BOM', async () => {
    await expect(reviewEventFile(new File([new Uint8Array([255, 123, 125])], 'invalid.json'))).rejects.toThrow('UTF-8');
    const reviewed = await reviewEventFile(new File([new Uint8Array([239,187,191,123,125])], 'bom.json'));
    expect(reviewed.records).toBe(1);
    await expect(reviewEventFile(new File([new Uint8Array([239,187,191,239,187,191,123,125])], 'two-boms.json'))).rejects.toThrow('Invalid JSON');
  });

  it('shows field names only from the first three records with a bounded list', () => {
    const result = reviewEventText(JSON.stringify([{ a: 'private value' }, { b: 1 }, { c: false }, { neverSampled: 1 }]));
    expect(result.sampleFields).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(result)).not.toContain('private value');
  });
});

it('limits nesting iteratively and shortens unusually long sample field names', () => {
  expect(reviewEventText('{"x":'.repeat(63) + '{}' + '}'.repeat(63)).records).toBe(1);
  expect(() => reviewEventText('{"x":'.repeat(64) + '{}' + '}'.repeat(64))).toThrow('64 levels');
  const reviewed = reviewEventText(JSON.stringify({ ['x'.repeat(200)]: 1 }));
  expect(reviewed.sampleFields[0].length).toBe(103);
});
