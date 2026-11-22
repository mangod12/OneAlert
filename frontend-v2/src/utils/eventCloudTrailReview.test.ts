import { describe, expect, it } from 'vitest';
import { reviewEventFile, reviewEventText } from './eventFileReview';

describe('Explicit CloudTrail local envelope review', () => {
  const text = JSON.stringify({ Records: [{ eventVersion: '1.11', privateValue: 'NEVER_SAMPLE' }, { eventTime: '2026-01-01T00:00:00Z' }] });
  it('counts inner records only for the selected parser and samples names rather than values', async () => {
    expect(reviewEventText(text).records).toBe(1);
    expect(reviewEventText(text, 'linux_journal').records).toBe(1);
    const result = reviewEventText(text, 'aws_cloudtrail');
    expect(result).toEqual({ format: 'CloudTrail Records envelope', records: 2, sampleFields: ['eventVersion', 'privateValue', 'eventTime'] });
    expect(JSON.stringify(result)).not.toContain('NEVER_SAMPLE');
    await expect(reviewEventFile(new File([text], 'trail.json'), 'aws_cloudtrail')).resolves.toEqual(result);
  });
  it.each([{ Records: [] }, { Records: null }, { Records: {} }, { Records: [null] }, { Records: [{}], extra: 'private' }])('rejects a whole malformed or ambiguous wrapper', value => {
    expect(() => reviewEventText(JSON.stringify(value), 'aws_cloudtrail')).toThrow();
  });
  it('does not decode LookupEvents, embedded strings, nested envelopes or arrays of wrappers', () => {
    for (const value of [{ Events: [{ CloudTrailEvent: '{"eventVersion":"1.11"}' }] }, { Records: [{ Records: [{ eventVersion: '1.11' }] }] }, [{ Records: [{ eventVersion: '1.11' }] }]]) {
      expect(reviewEventText(JSON.stringify(value), 'aws_cloudtrail').records).toBe(1);
    }
  });
  it('applies the complete record and nesting limits to the unwrapped array', () => {
    expect(reviewEventText(JSON.stringify({ Records: Array(50_000).fill({}) }), 'aws_cloudtrail').records).toBe(50_000);
    expect(() => reviewEventText(JSON.stringify({ Records: Array(50_001).fill({}) }), 'aws_cloudtrail')).toThrow('50,000');
    expect(() => reviewEventText('{"Records":[' + '{"x":'.repeat(64) + '{}' + '}'.repeat(64) + ']}', 'aws_cloudtrail')).toThrow('64 levels');
  });
});
