export interface IncidentExportRow {
  asset_id: number;
  asset_name: string;
  asset_vendor: string | null;
  asset_product: string | null;
  asset_criticality: string | null;
  max_severity: string;
  alert_count: number;
  shared_cves: string[];
  first_seen: string | null;
  last_seen: string | null;
  blast_radius: number;
  linked_cases: Array<{ id: number; title: string; status: string }>;
}

function cell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  // Quoting alone does not prevent spreadsheet formulas from executing.
  let start = 0;
  while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/u.test(raw[start]))) start++;
  const safe = '=+@-'.includes(raw[start] ?? '\uffff') ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function incidentCsv(incidents: IncidentExportRow[]): string {
  const rows: unknown[][] = [[
    'asset_id', 'asset_name', 'vendor', 'product', 'asset_criticality',
    'max_severity', 'active_alert_count', 'cves', 'first_seen', 'last_seen',
    'observed_connection_count', 'linked_investigations',
  ]];
  for (const incident of incidents) {
    rows.push([
      incident.asset_id, incident.asset_name, incident.asset_vendor,
      incident.asset_product, incident.asset_criticality, incident.max_severity,
      incident.alert_count, incident.shared_cves.join('; '), incident.first_seen,
      incident.last_seen, incident.blast_radius,
      incident.linked_cases.map(c => `#${c.id}: ${c.title} (${c.status})`).join('; '),
    ]);
  }
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
