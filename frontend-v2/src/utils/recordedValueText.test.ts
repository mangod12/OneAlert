import { expect, it } from 'vitest';
import { recordedValueText } from './recordedValueText';
it('preserves zero, false and strings while keeping absence distinct', () => {
  expect(recordedValueText(0)).toBe('0'); expect(recordedValueText(false)).toBe('false');
  expect(recordedValueText(null)).toBe('Not recorded'); expect(recordedValueText(undefined, '')).toBe('');
});
it('treats structured evidence as JSON without invoking its conversion fields', () => {
  expect(recordedValueText({ toString: 'recorded-data', valueOf: 'also-data' })).toBe('{"toString":"recorded-data","valueOf":"also-data"}');
  expect(recordedValueText(['notify', 0, false])).toBe('["notify",0,false]');
});
it('does not crash if an unexpected non-JSON cycle reaches the formatter', () => {
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  expect(recordedValueText(cyclic)).toBe('Recorded value could not be rendered');
});
