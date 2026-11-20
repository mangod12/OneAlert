import type { DeviceRecord } from '../components/DiscoveredDeviceInspector';
const recordedFields: (keyof DeviceRecord)[] = ['id', 'ip_address', 'hostname', 'mac_address', 'device_class', 'manufacturer', 'model', 'firmware_version', 'serial_number', 'is_ot_device', 'ot_device_type', 'confidence', 'discovery_method', 'sensor_id', 'asset_id', 'is_correlated', 'correlation_score', 'risk_score', 'risk_factors', 'ports_open', 'services_detected', 'protocols', 'industrial_protocols', 'first_seen', 'last_seen'];
export function deviceEvidenceSnapshot(record: DeviceRecord, includeAnnotations: boolean, exportedAt: string) {
  const fields = includeAnnotations ? [...recordedFields, 'description', 'notes', 'tags'] as (keyof DeviceRecord)[] : recordedFields;
  return {
    schema_version: 1,
    evidence_type: 'recorded_discovered_device',
    exported_at: exportedAt,
    scope: 'One owner-visible inventory record, not a live scan or connectivity check. Inventory and manual enrichment fields are included as currently returned. Different records may share the same IP address.',
    annotations_included: includeAnnotations,
    device: Object.fromEntries(fields.map(field => [field, record[field] ?? null])),
  };
}
