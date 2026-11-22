import type { Timeline, WindowPage, WindowRecord } from './sourceTimeline';

const coverageFields = ['source_ip', 'dest_ip', 'hostname', 'username', 'domain'] as const;
const groupFields = ['severity', 'event_type', 'source_type', 'processed'] as const;
export interface SourceProfile {
  source: { id: number; name: string; source_type: string; status: string | null; event_count: number | null; last_event_at: string | null; created_at: string };
  retained_event_count: number; first_observed_at: string | null; last_observed_at: string | null;
  first_created_at: string | null; last_created_at: string | null;
  nonempty_field_counts: Record<typeof coverageFields[number], number>;
  groups: Record<typeof groupFields[number], { value: string | null; count: number }[]>;
  retrieved_at: string; scope: string;
}
const rowFields = ['id', 'timestamp', 'event_type', 'severity', 'signature', 'source_ip', 'dest_ip', 'hostname', 'source_type', 'processed'] as const;
const pick = <T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])) as Pick<T, K>;

// Call only after the view's complete-scope validator accepts the response.
// Explicit copies prevent unexpected API fields at any layer entering downloads.
export function sourceProfileMetadata(value: SourceProfile) {
  return {
    ...pick(value, ['retained_event_count', 'first_observed_at', 'last_observed_at', 'first_created_at', 'last_created_at', 'retrieved_at']),
    source: pick(value.source, ['id', 'name', 'source_type', 'status', 'event_count', 'last_event_at', 'created_at']),
    nonempty_field_counts: pick(value.nonempty_field_counts, coverageFields),
    groups: Object.fromEntries(groupFields.map(field => [field, value.groups[field].map(row => pick(row, ['value', 'count']))])),
    scope: 'Loaded source record and currently retained owned source-event aggregates. Separate reads, not an atomic snapshot, exact import batch, complete history or live health check.',
  };
}
export const sourceRecordMetadata = (value: WindowRecord) => pick(value, rowFields);
export function sourceGroupMetadata<T extends { source_id: number; group: string; value: string | null; missing: boolean; page: number; size: number; total: number; records: WindowRecord[]; retrieved_at: string }>(value: T) {
  return { ...pick(value, ['source_id', 'group', 'value', 'missing', 'page', 'size', 'total', 'retrieved_at']), records: value.records.map(sourceRecordMetadata), scope: 'Loaded exact owned source and recorded-label event page. Not an import batch, full history or proof of arrival.' };
}
export function sourceWindowMetadata(value: WindowPage) {
  return { ...pick(value, ['source_id', 'started_at', 'ended_before', 'page', 'size', 'total', 'retrieved_at']), records: value.records.map(sourceRecordMetadata), scope: 'Loaded exact owned source and inclusive/exclusive saved-observation window event page. Not an import batch or proof of arrival.' };
}
export function sourceDistributionMetadata(value: Timeline) {
  return { ...pick(value, ['source_id', 'started_at', 'ended_before', 'bucket_hours', 'total', 'retrieved_at']), buckets: value.buckets.map(row => pick(row, ['started_at', 'ended_before', 'count'])), scope: 'Complete loaded owned-source saved-observation distribution, including zero-count buckets. Not an import batch, arrival, live activity or health evidence.' };
}
