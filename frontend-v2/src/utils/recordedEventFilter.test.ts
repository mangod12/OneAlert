import { expect, it } from 'vitest';
import { recordedEventFilter, recordedEventFilterLink, recordedEventFields } from './recordedEventFilter';
it.each(recordedEventFields)('preserves exact Unicode, whitespace, case, percent and underscore in %s links', field => {
  const value = '  Actor_%+&/名😀\n  ';
  expect(recordedEventFilter(field, value)).toEqual({ field, value });
  const link = new URL(recordedEventFilterLink(field, value), 'https://example.invalid');
  expect(link.pathname).toBe('/app/events'); expect([...link.searchParams]).toEqual([['recorded_field', field], ['recorded_value', value]]);
});
it('allows absent scope and a full 1024 Unicode codepoints without normalization', () => {
  expect(recordedEventFilter(undefined, undefined)).toBeNull(); expect(recordedEventFilter('username', '😀'.repeat(1024))?.value).toHaveLength(2048);
  expect(recordedEventFilter('username', 'é')?.value).not.toBe(recordedEventFilter('username', 'e\u0301')?.value);
});
it.each([[undefined, 'actor'], ['username', undefined], ['raw_data', 'actor'], ['Username', 'actor'], ['username', ''], ['username', ' '], ['username', 1], ['username', 'x'.repeat(1025)], ['username', 'nul\0label'], ['username', '\ud800']])('refuses unsupported or partial scope without coercion %s', (field, value) => {
  expect(() => recordedEventFilter(field, value)).toThrow('No unfiltered read');
});
