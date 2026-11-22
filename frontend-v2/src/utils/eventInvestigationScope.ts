import { recordedEventFilter } from './recordedEventFilter';

/** A complete, versioned query recipe, never event rows or account access. */
export interface EventInvestigationScope {
  version: 1;
  source_id: string;
  recorded_field: string;
  recorded_value: string;
  started_at: string;
  ended_before: string;
  severity: string;
  event_type: string;
  source_type: string;
  ip: string;
  signature: string;
  sort: string;
}
export const eventScopeKeys = ['version', 'source_id', 'recorded_field', 'recorded_value', 'started_at', 'ended_before', 'severity', 'event_type', 'source_type', 'ip', 'signature', 'sort'] as const;
export const emptyEventScope: EventInvestigationScope = {
  version: 1, source_id: '', recorded_field: '', recorded_value: '', started_at: '', ended_before: '',
  severity: '', event_type: '', source_type: '', ip: '', signature: '', sort: 'timestamp_desc',
};
const invalid = () => Error('The complete applied event scope could not be verified. No broader event query was substituted.');

/** Validate calendar components and compare instants without dropping API microseconds. */
function timestampMicros(value: string): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw invalid();
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  if (parts[0] < 1 || parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) throw invalid();
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  date.setUTCHours(parts[3], parts[4], parts[5], 0);
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) throw invalid();
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (hours > 23 || minutes > 59) throw invalid();
    offsetMinutes = (hours * 60 + minutes) * (zone[0] === '+' ? 1 : -1);
  }
  return BigInt(date.getTime() - offsetMinutes * 60000) * 1000n + BigInt(fraction.padEnd(6, '0') || '0');
}

export function checkedEventScope(value: unknown): EventInvestigationScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== eventScopeKeys.length || raw.version !== 1) throw invalid();
  for (const key of eventScopeKeys) {
    if (!Object.hasOwn(raw, key)) throw invalid();
    if (key === 'version') continue;
    const field = raw[key];
    if (typeof field !== 'string' || Array.from(field).length > 1024 || /[\uD800-\uDFFF]/u.test(field) || field.includes(String.fromCharCode(0))) throw invalid();
    if (field && key !== 'recorded_value' && field !== field.trim()) throw invalid();
  }
  const scope = Object.fromEntries(eventScopeKeys.map(key => [key, raw[key]])) as unknown as EventInvestigationScope;
  if (scope.source_id && (!/^[1-9][0-9]*$/.test(scope.source_id) || Number(scope.source_id) > 2147483647)) throw invalid();
  recordedEventFilter(scope.recorded_field || undefined, scope.recorded_value || undefined);
  if (!['', 'info', 'low', 'medium', 'high', 'critical'].includes(scope.severity)) throw invalid();
  if (!['timestamp_desc', 'timestamp_asc', 'severity_desc', 'severity_asc'].includes(scope.sort)) throw invalid();
  const start = scope.started_at ? timestampMicros(scope.started_at) : null;
  const end = scope.ended_before ? timestampMicros(scope.ended_before) : null;
  if (start !== null && end !== null && start >= end) throw invalid();
  return scope;
}

export function eventScopeLink(scope: EventInvestigationScope): string {
  const checked = checkedEventScope(scope);
  const serialized = JSON.stringify(checked);
  if (serialized.length > 16384) throw invalid();
  return `/app/events?${new URLSearchParams({ event_scope: serialized })}`;
}

export function eventScopeFromParams(params: URLSearchParams): EventInvestigationScope | null {
  if (!params.has('event_scope')) return null;
  if ([...params.keys()].length !== 1 || params.getAll('event_scope').length !== 1) throw invalid();
  const serialized = params.get('event_scope')!;
  if (serialized.length > 16384) throw invalid();
  const checked = checkedEventScope(JSON.parse(serialized));
  // Our fixed wire format rejects duplicate JSON keys, omitted fields and ambiguous rewrites.
  if (JSON.stringify(checked) !== serialized) throw invalid();
  return checked;
}
