import { describe, expect, it } from 'vitest';
import { deviceEvidenceSnapshot } from './deviceEvidenceSnapshot';
describe('Recorded device handoff', () => {
  it('preserves zero, false, empty arrays, timestamps and explicit null while excluding private annotations and unknown API fields', () => {
    const source = { id: 7, ip_address: '192.0.2.7', risk_score: 0, is_ot_device: false, ports_open: [0, 502], protocols: [], first_seen: '2026-11-20T12:34:56+05:30', notes: 'private', description: 'private description', tags: ['private'], user_id: 123 };
    const snapshot = deviceEvidenceSnapshot(source, false, '2026-11-20T08:00:00Z');
    expect(snapshot.device).toMatchObject({ id: 7, risk_score: 0, is_ot_device: false, ports_open: [0, 502], protocols: [], first_seen: source.first_seen, asset_id: null });
    for (const key of ['notes', 'description', 'tags', 'user_id']) expect(snapshot.device).not.toHaveProperty(key);
    expect(snapshot.exported_at).toBe('2026-11-20T08:00:00Z'); expect(snapshot.annotations_included).toBe(false);
  });
  it('includes annotations only when explicitly selected', () => {
    const snapshot = deviceEvidenceSnapshot({ id: 7, ip_address: '192.0.2.7', notes: 'Handoff note', description: 'Controller', tags: [] }, true, 'now');
    expect(snapshot.device).toMatchObject({ notes: 'Handoff note', description: 'Controller', tags: [] }); expect(snapshot.annotations_included).toBe(true);
  });
});
