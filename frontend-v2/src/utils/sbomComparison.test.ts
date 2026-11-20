import { describe, expect, it } from 'vitest';
import { compareSnapshots, type SnapshotComponent } from './sbomComparison';

const component = (overrides: Partial<SnapshotComponent> = {}): SnapshotComponent => ({ id: 1, sbom_id: 1, name: 'openssl', supplier: 'OpenSSL', version: '3.0', purl: null, cpe: null, license: 'Apache-2.0', has_known_vulnerability: 0, ...overrides });

describe('SBOM snapshot comparison', () => {
  it('ignores database IDs and pairs unique exact identities', () => {
    expect(compareSnapshots([component()], [component({ id: 2, sbom_id: 2 })])[0].kind).toBe('unchanged');
  });
  it('compares each recorded field, including zero and missing evidence', () => {
    const row = compareSnapshots([component()], [component({ version: '3.1', license: null, purl: 'pkg:generic/openssl@3.1', cpe: 'cpe:2.3:a:openssl', has_known_vulnerability: 2 })])[0];
    expect(row.kind).toBe('changed');
    expect(row.fields).toEqual(['version', 'purl', 'cpe', 'license', 'has_known_vulnerability']);
  });
  it('shows additions and removals directionally', () => {
    expect(compareSnapshots([], [component()])[0].kind).toBe('added');
    expect(compareSnapshots([component()], [])[0].kind).toBe('removed');
    expect(compareSnapshots([], [])).toEqual([]);
  });
  it('does not infer identities across renamed packages or supplier changes', () => {
    const result = compareSnapshots([component()], [component({ supplier: null }), component({ name: 'OpenSSL' })]);
    expect(result.map(row => row.kind).sort()).toEqual(['added', 'added', 'removed']);
  });
  it('does not normalize missing supplier into an explicitly empty supplier', () => {
    expect(compareSnapshots([component({ supplier: null })], [component({ supplier: '' })]).map(row => row.kind).sort()).toEqual(['added', 'removed']);
  });
  it('marks duplicate identities ambiguous on either side, even if only one version looks similar', () => {
    for (const [before, after] of [[[component(), component({ version: '2.0' })], [component()]], [[component()], [component(), component()]], [[], [component(), component()]]]) {
      const result = compareSnapshots(before, after);
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('ambiguous');
      expect(result[0].fields).toEqual([]);
    }
  });
  it('orders deterministically and never changes source records', () => {
    const rows = [component({ name: 'z' }), component({ name: 'a' })];
    const saved = JSON.stringify(rows);
    expect(compareSnapshots([], rows).map(row => row.name)).toEqual(['a', 'z']);
    expect(JSON.stringify(rows)).toBe(saved);
  });
});
