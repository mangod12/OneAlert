import { describe, expect, it } from 'vitest';
import { topologyCsv } from './topologyCsv';
const edge = { id: 7, source: '192.0.2.1', target: '192.0.2.2', protocol: 'modbus', port: 0, is_encrypted: false };
const scope = { protocol: 'modbus', cleartextOnly: true, nodeId: '192.0.2.1' };
describe('Topology snapshot CSV', () => {
  it('includes exact recorded observation fields without inventing absent legacy fields', () => {
    const csv = topologyCsv([{ ...edge, direction: 'outbound', bytes_transferred: '9223372036854775807', first_seen: '2026-11-20T12:00:00', last_seen: '2026-11-20T13:00:00', source_device_id: 8 }], [], { ...scope, receivedAt: '2026-11-20T14:00:00Z' });
    expect(csv).toContain('recorded_bytes_transferred'); expect(csv).toContain('"9223372036854775807"');
    expect(csv).toContain('"2026-11-20T12:00:00"'); expect(csv).toContain('"2026-11-20T14:00:00Z"');
    expect(topologyCsv([{ ...edge, bytes_transferred: Number.MAX_SAFE_INTEGER + 1 }], [], scope)).toContain('Numeric precision unavailable');
  });
  it('preserves identity, filter scope, zero port, encryption and missing-node fallback', () => {
    const csv = topologyCsv([edge], [{ id: edge.source, label: 'Plant gateway', zone: 'control' }], scope);
    expect(csv).toContain('"7","192.0.2.1","Plant gateway","control","192.0.2.2","192.0.2.2","","modbus","0","cleartext","modbus","true","192.0.2.1"');
    expect(csv).toContain('loaded topology snapshot, not a live connectivity check');
    expect(topologyCsv([], [], scope).split('\r\n')).toHaveLength(2);
  });
  it.each(['=', '+', '-', '@', '  =', '\t=', '\r='])('mitigates formula-like text beginning %j', prefix => {
    const csv = topologyCsv([{ ...edge, protocol: prefix + '1+2' }], [{ id: edge.source, label: prefix + 'label', zone: prefix + 'zone' }], { ...scope, protocol: prefix + 'filter' });
    expect(csv).toContain(`"'${prefix}label"`);
    expect(csv).toContain(`"'${prefix}zone"`);
    expect(csv).toContain(`"'${prefix}1+2"`);
    expect(csv).toContain(`"'${prefix}filter"`);
  });
  it('quotes commas, newlines and quotes without changing ordinary text', () => {
    expect(topologyCsv([edge], [{ id: edge.source, label: 'Gateway, "north"\nLine 2', zone: null }], scope)).toContain('"Gateway, ""north""\nLine 2"');
  });
});
