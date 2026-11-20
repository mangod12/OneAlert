import { expect, it } from 'vitest';
import { compareSnapshots, type SnapshotComponent } from './sbomComparison';
import { sbomComparisonCsv } from './sbomComparisonCsv';
const record: SnapshotComponent = { id: 1, sbom_id: 1, name: '=Recorded, "package"\nname', supplier: '\t@vendor', version: null, purl: null, cpe: null, license: '', has_known_vulnerability: 0 };

it('exports source IDs, directional changes, field changes and complete duplicate evidence', () => {
  const rows = compareSnapshots([record, record], [{ ...record, sbom_id: 2 }]);
  const csv = sbomComparisonCsv(1, 2, rows);
  expect(csv).toContain('"1","2"');
  expect(csv).toContain('"ambiguous","","2","1"');
  expect(csv).toContain('"baseline_components_json"');
  expect(csv).toContain('""version"":null');
  expect(csv).toContain('""has_known_vulnerability"":0');
  expect(csv).toContain('""license"":""""');
});

it('quotes multiline cells and neutralizes spreadsheet formulas without changing JSON evidence', () => {
  const csv = sbomComparisonCsv(1, 2, compareSnapshots([record], []));
  expect(csv).toContain('"\'=Recorded, ""package""\nname"');
  expect(csv).toContain('"\'\t@vendor"');
  expect(csv).toContain('""name"":""=Recorded');
});

it('includes only the supplied filtered groups, never hidden or extra groups', () => {
  const rows = compareSnapshots([], [record, { ...record, name: 'Other record' }]);
  const csv = sbomComparisonCsv(1, 2, rows.filter(row => row.name === 'Other record'));
  expect(csv).toContain('Other record');
  expect(csv).not.toContain('Recorded');
  expect(sbomComparisonCsv(1, 2, []).split('\r\n')).toHaveLength(1);
});


it('exports recorded hash changes and their original evidence', () => {
  const rows = compareSnapshots([{ ...record, hash_sha256: 'recorded-before' }], [{ ...record, sbom_id: 2, hash_sha256: 'recorded-after' }]);
  const csv = sbomComparisonCsv(1, 2, rows);
  expect(csv).toContain('"hash_sha256"');
  expect(csv).toContain('""hash_sha256"":""recorded-before""');
  expect(csv).toContain('""hash_sha256"":""recorded-after""');
});
