import { expect, it } from 'vitest';
import { sourceDistributionMetadata, sourceGroupMetadata, sourceProfileMetadata, sourceWindowMetadata } from './sourceEvidenceMetadata';
const stamp = '2026-11-01T00:00:00Z', end = '2026-11-01T01:00:00Z';
const row = () => ({ id: 1, timestamp: stamp, event_type: 'dns', severity: null, signature: '', source_ip: null, dest_ip: '192.0.2.4', hostname: 'recorded-host', source_type: 'upload', processed: null, raw_data: { password: 'PRIVATE' }, credentials: 'PRIVATE' });
it('copies only recorded profile fields at every layer and replaces untrusted scope prose', () => {
  const group = () => [{ value: '', count: 1, raw_data: 'PRIVATE' }];
  const value = { source: { id: 7, name: 'source-name', source_type: 'upload', status: null, event_count: 0, last_event_at: null, created_at: stamp, configuration: 'PRIVATE' }, retained_event_count: 1, first_observed_at: stamp, last_observed_at: stamp, first_created_at: null, last_created_at: null, nonempty_field_counts: { source_ip: 0, dest_ip: 0, hostname: 1, username: 0, domain: 0, extra: 'PRIVATE' }, groups: { severity: group(), event_type: group(), source_type: group(), processed: group(), extra: 'PRIVATE' }, retrieved_at: stamp, scope: 'PRIVATE', payload: 'PRIVATE' };
  const result = sourceProfileMetadata(value), text = JSON.stringify(result);
  expect(text).not.toContain('PRIVATE'); expect(result.source.event_count).toBe(0); expect(result.source.last_event_at).toBeNull(); expect(result.groups.severity).toEqual([{ value: '', count: 1 }]); expect(result.nonempty_field_counts.hostname).toBe(1); expect(result.scope).toContain('not an atomic snapshot'); expect(value.source.configuration).toBe('PRIVATE');
});
it.each([null, ''])('keeps exact group missing/empty identity and only the loaded page while stripping unexpected nested payloads %s', value => {
  const result = sourceGroupMetadata({ source_id: 7, group: 'severity', value, missing: value === null, page: 2, size: 10, total: 11, records: [row()], retrieved_at: stamp, scope: 'PRIVATE', account: 'PRIVATE' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(result.value).toBe(value); expect(result.missing).toBe(value === null); expect(result.page).toBe(2); expect(result.records).toHaveLength(1); expect(result.records[0].severity).toBeNull(); expect(result.records[0].signature).toBe(''); expect(result.records[0].dest_ip).toBe('192.0.2.4');
});
it('keeps complete distribution zero buckets and exact boundaries but no unknown aggregate or bucket fields', () => {
  const value = { source_id: 7, started_at: stamp, ended_before: end, bucket_hours: 1, total: 0, buckets: [{ started_at: stamp, ended_before: end, count: 0, raw_data: 'PRIVATE' }], retrieved_at: stamp, scope: 'PRIVATE', raw_data: 'PRIVATE' };
  const result = sourceDistributionMetadata(value);
  expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(result.buckets).toEqual([{ started_at: stamp, ended_before: end, count: 0 }]); expect(result.total).toBe(0); expect(result.scope).toContain('including zero-count buckets');
});
it('keeps exact window/page/row metadata without exposing unexpected event or root fields', () => {
  const value = { source_id: 7, started_at: stamp, ended_before: end, page: 1, size: 10, total: 1, records: [row()], retrieved_at: stamp, scope: 'PRIVATE', source_configuration: 'PRIVATE' };
  const result = sourceWindowMetadata(value);
  expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(result.started_at).toBe(stamp); expect(result.ended_before).toBe(end); expect(Object.keys(result.records[0]).sort()).toEqual(['dest_ip', 'event_type', 'hostname', 'id', 'processed', 'severity', 'signature', 'source_ip', 'source_type', 'timestamp']);
});
