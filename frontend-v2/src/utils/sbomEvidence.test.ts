import { describe, expect, it } from 'vitest';
import { componentEvidenceCsv, componentEvidenceJson, evidenceGapCounts, hasEvidenceGap, hasRecordedValue, type ComponentEvidence, type EvidenceSnapshot } from './sbomEvidence';
const component: ComponentEvidence = { id: 8, sbom_id: 3, name: 'gateway', version: '1.0', supplier: null, purl: 'pkg:generic/gateway@1.0', cpe: null, license: 'MIT', hash_sha256: null, has_known_vulnerability: 0 };
const snapshot: EvidenceSnapshot = { sbom: { id: 3, asset_id: 4, format: 'SPDX', version: 'SPDX-2.3', source: 'upload', created_at: '2026-11-20T12:00:00Z', component_count: 5 }, loadedCount: 2, components: [component], filters: { search: 'gateway', recordedVulnerabilitiesOnly: false, evidenceGap: 'hash' }, exportedAt: '2026-11-20T12:05:00Z' };
describe('SBOM evidence completeness and handoff', () => {
  it.each([null, undefined, '', '  ', 'NOASSERTION', ' none '])('does not treat unspecified evidence as usable: %s', value => { expect(hasRecordedValue(value)).toBe(false); });
  it('counts missing fields without treating an identifier as a dependency or vulnerability finding', () => {
    expect(evidenceGapCounts([component, { ...component, id: 9, version: '', purl: null, license: 'NOASSERTION', supplier: 'Vendor', hash_sha256: 'recorded' }])).toEqual({ version: 1, supplier: 1, identifier: 1, license: 1, hash: 1 });
    expect(hasEvidenceGap({ ...component, purl: null, cpe: 'cpe:2.3:a:vendor:gateway' }, 'identifier')).toBe(false);
    expect(hasEvidenceGap(component, '')).toBe(true);
  });
  it('exports only selected component evidence with recorded IDs, filters and snapshot counts', () => {
    const result = JSON.parse(componentEvidenceJson(snapshot));
    expect(result.exported_component_count).toBe(1); expect(result.loaded_component_count).toBe(2);
    expect(result.sbom.component_count).toBe(5); expect(result.filters).toEqual(snapshot.filters);
    expect(result.components[0].recorded_vulnerability_reference_count).toBe(0);
    expect(result.components[0].hash_sha256).toBeNull();
    expect(result.scope).toContain('Not a live vulnerability scan');
    expect(result.exported_at).toBe(snapshot.exportedAt);
  });
  it('quotes CSV newlines and quotes, prevents spreadsheet formulas and keeps zeros', () => {
    const result = componentEvidenceCsv({ ...snapshot, components: [{ ...component, name: ' =1+2', supplier: 'Vendor,"A"\nB', version: '@SUM(1)' }] });
    expect(result).toContain('"\' =1+2"'); expect(result).toContain('"\'@SUM(1)"');
    expect(result).toContain('"Vendor,""A""\nB"'); expect(result).toContain('"0"');
    expect(result).toContain('recorded_vulnerability_references'); expect(result).toContain('sbom_uploaded_at');
  });
  it('keeps header-only and empty JSON exports honest when no rows match', () => {
    expect(componentEvidenceCsv({ ...snapshot, components: [] }).trim().split('\r\n')).toHaveLength(1);
    expect(JSON.parse(componentEvidenceJson({ ...snapshot, components: [] })).exported_component_count).toBe(0);
  });
});
