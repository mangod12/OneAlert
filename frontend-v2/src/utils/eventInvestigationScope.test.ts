import { expect, it } from 'vitest';
import { checkedEventScope, emptyEventScope, eventScopeFromParams, eventScopeKeys, eventScopeLink } from './eventInvestigationScope';
const complete = { ...emptyEventScope, source_id: '7', recorded_field: 'username', recorded_value: ' Actor_%+名 ', started_at: '2026-01-01T00:00:00.000001Z', ended_before: '2026-01-01T00:00:00.000002Z', severity: 'high', event_type: 'okta_system', source_type: 'okta_system', ip: '192.0.2.%', signature: 'label_%+名', sort: 'timestamp_asc' };
const params = (scope: unknown) => new URLSearchParams({ event_scope: JSON.stringify(scope) });
it('roundtrips the full applied recipe without trim, time-precision loss, rows, pagination or grants', () => {
  const href = eventScopeLink(complete); expect(href.startsWith('/app/events?event_scope=')).toBe(true);
  expect(eventScopeFromParams(new URL(href, 'https://example.test').searchParams)).toEqual(complete);
  expect(checkedEventScope({ ...complete })).toEqual(complete); expect(Object.keys(checkedEventScope(complete))).toEqual([...eventScopeKeys]);
});
it('represents each absence explicitly so an omitted field cannot silently widen the query', () => {
  expect(eventScopeFromParams(params(emptyEventScope))).toEqual(emptyEventScope);
  for (const key of eventScopeKeys) { const raw = { ...complete } as Record<string, unknown>; delete raw[key]; expect(() => eventScopeFromParams(params(raw))).toThrow(); }
});
it.each([undefined, null, [], {}, { ...complete, version: 2 }, { ...complete, page: 3 }, { ...complete, raw_data: {} }, { ...complete, source_id: 7 }, { ...complete, source_id: '01' }, { ...complete, source_id: '0' }, { ...complete, source_id: '2147483648' }, { ...complete, source_id: '-1' }, { ...complete, recorded_field: 'raw_data' }, { ...complete, recorded_value: '' }, { ...complete, recorded_field: '' }, { ...complete, recorded_value: '  ' }, { ...complete, severity: 'urgent' }, { ...complete, sort: 'unknown' }, { ...complete, signature: ' spaced ' }, { ...complete, ip: true }, { ...complete, recorded_value: 'x'.repeat(1025) }, { ...complete, recorded_value: String.fromCharCode(0) }, { ...complete, signature: '\uD800' }])('rejects an unsupported, incomplete or ambiguous scope %#', value => {
  expect(() => checkedEventScope(value)).toThrow();
});
it.each(['2026-01-01', '2026-01-01T00:00:00', '2026-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-00-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-04-31T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+05:60', '0000-01-01T00:00:00Z', '2026-01-01T00:00:00.0000001Z', 'not-a-time'])('validates aware calendar time, not Date rollover: %s', started_at => {
  expect(() => checkedEventScope({ ...emptyEventScope, started_at })).toThrow();
});
it('compares real instants across offsets and preserves microsecond boundaries exactly', () => {
  expect(checkedEventScope(complete)).toEqual(complete);
  expect(() => checkedEventScope({ ...complete, ended_before: complete.started_at })).toThrow();
  expect(() => checkedEventScope({ ...complete, started_at: complete.ended_before, ended_before: complete.started_at })).toThrow();
  expect(() => checkedEventScope({ ...emptyEventScope, started_at: '2026-01-01T05:30:00.000001+05:30', ended_before: '2026-01-01T00:00:00.000001Z' })).toThrow();
  const offset = { ...emptyEventScope, started_at: '2026-01-01T05:30:00.000001+05:30', ended_before: '2026-01-01T00:00:00.000002Z' };
  expect(eventScopeFromParams(new URL(eventScopeLink(offset), 'https://example.test').searchParams)).toEqual(offset);
  expect(checkedEventScope({ ...emptyEventScope, started_at: '2024-02-29T23:59:59.999999Z' }).started_at).toBe('2024-02-29T23:59:59.999999Z');
});
it('rejects mixed or repeated query parameters and repeated JSON keys instead of taking the last value', () => {
  for (const key of ['source_id', 'recorded_field', 'page', 'unknown']) { const raw = params(complete); raw.append(key, '7'); expect(() => eventScopeFromParams(raw)).toThrow(); }
  const repeated = params(complete); repeated.append('event_scope', JSON.stringify(emptyEventScope)); expect(() => eventScopeFromParams(repeated)).toThrow();
  for (const serialized of ['', '{', '{}', JSON.stringify(complete).replace('"version":1', '"version":2,"version":1'), JSON.stringify(complete, null, 2)]) expect(() => eventScopeFromParams(new URLSearchParams({ event_scope: serialized }))).toThrow();
  expect(eventScopeFromParams(new URLSearchParams('source_id=7'))).toBeNull();
});
it('keeps exact astral Unicode text at its 1024-codepoint boundary and bounds the full wire payload', () => {
  const scope = { ...emptyEventScope, recorded_field: 'username', recorded_value: '😀'.repeat(1024) }; expect(eventScopeFromParams(new URL(eventScopeLink(scope), 'https://example.test').searchParams)).toEqual(scope);
  expect(() => checkedEventScope({ ...scope, recorded_value: scope.recorded_value + 'x' })).toThrow();
  expect(() => eventScopeFromParams(new URLSearchParams({ event_scope: 'x'.repeat(16385) }))).toThrow();
  expect(() => eventScopeLink({ ...emptyEventScope, event_type: '\u0001'.repeat(1024), source_type: '\u0001'.repeat(1024), signature: '\u0001'.repeat(1024) })).toThrow();
});
