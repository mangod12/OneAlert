import { describe, expect, it } from 'vitest';
import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  it('renders an em dash for missing data', () => {
    expect(formatDuration(null)).toBe('—');
  });
  it('renders seconds under a minute', () => {
    expect(formatDuration(42)).toBe('42s');
  });
  it('renders minutes under an hour', () => {
    expect(formatDuration(90)).toBe('2m');
    expect(formatDuration(3540)).toBe('59m');
  });
  it('renders hours under a day', () => {
    expect(formatDuration(5400)).toBe('1.5h');
    expect(formatDuration(18000)).toBe('5.0h');
  });
  it('renders days beyond that', () => {
    expect(formatDuration(172800)).toBe('2.0d');
  });
});
