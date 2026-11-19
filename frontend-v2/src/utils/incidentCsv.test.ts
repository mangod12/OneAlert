import { describe, expect, it } from 'vitest';
import { incidentCsv, type IncidentExportRow } from './incidentCsv';

const incident: IncidentExportRow = {
  asset_id: 5, asset_name: 'plc-01', asset_vendor: 'Acme', asset_product: null,
  asset_criticality: 'critical', max_severity: 'high', alert_count: 2,
  shared_cves: ['CVE-2026-1', 'CVE-2026-2'], first_seen: null,
  last_seen: '2026-11-19T01:00:00Z', blast_radius: 3,
  linked_cases: [{ id: 7, title: 'Investigation', status: 'open' }],
};

describe('incident CSV', () => {
  it('exports exact row context, nulls and linked investigations', () => {
    const csv = incidentCsv([incident]);
    expect(csv.startsWith('\ufeff"asset_id",')).toBe(true);
    expect(csv).toContain('"5","plc-01","Acme","","critical","high","2"');
    expect(csv).toContain('"CVE-2026-1; CVE-2026-2"');
    expect(csv).toContain('"#7: Investigation (open)"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
  it('quotes embedded commas, newlines and quotes', () => {
    expect(incidentCsv([{ ...incident, asset_name: 'line,"A"\nB' }])).toContain('"line,""A""\nB"');
  });
  it.each(['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '\t=1+1', '  =1+1', '\r\n+1', '\u0000=1'])('neutralizes formula prefix %j', value => {
    expect(incidentCsv([{ ...incident, asset_name: value }])).toContain(`"'${value}"`);
  });
  it('does not mutate input or invent records for empty lists', () => {
    const original = JSON.stringify(incident);
    incidentCsv([incident]);
    expect(JSON.stringify(incident)).toBe(original);
    expect(incidentCsv([]).split('\r\n')).toHaveLength(2);
  });
});
