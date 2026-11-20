export interface SnapshotComponent {
  id: number;
  sbom_id: number;
  name: string;
  supplier: string | null;
  version: string | null;
  purl: string | null;
  cpe: string | null;
  license: string | null;
  has_known_vulnerability: number;
}

export const comparisonFields = ['version', 'purl', 'cpe', 'license', 'has_known_vulnerability'] as const;
export type ComparisonField = typeof comparisonFields[number];
export type ComparisonKind = 'added' | 'removed' | 'changed' | 'unchanged' | 'ambiguous';
export interface ComponentDifference {
  key: string;
  name: string;
  supplier: string | null;
  kind: ComparisonKind;
  baseline: SnapshotComponent[];
  current: SnapshotComponent[];
  fields: ComparisonField[];
}

// Only pair unique exact name/supplier identities. Never guess between duplicate
// versions, case variants, renamed packages or changing supplier attribution.
export function compareSnapshots(baseline: SnapshotComponent[], current: SnapshotComponent[]): ComponentDifference[] {
  const groups = new Map<string, ComponentDifference>();
  for (const [side, rows] of [['baseline', baseline], ['current', current]] as const) {
    for (const component of rows) {
      const key = JSON.stringify([component.name, component.supplier]);
      let group = groups.get(key);
      if (!group) {
        group = { key, name: component.name, supplier: component.supplier, kind: 'unchanged', baseline: [], current: [], fields: [] };
        groups.set(key, group);
      }
      group[side].push(component);
    }
  }
  for (const group of groups.values()) {
    const before = group.baseline;
    const after = group.current;
    if (before.length > 1 || after.length > 1) group.kind = 'ambiguous';
    else if (!before.length) group.kind = 'added';
    else if (!after.length) group.kind = 'removed';
    else {
      group.fields = comparisonFields.filter(field => before[0][field] !== after[0][field]);
      group.kind = group.fields.length ? 'changed' : 'unchanged';
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}
