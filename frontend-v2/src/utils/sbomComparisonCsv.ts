import type { ComponentDifference } from './sbomComparison';

// JSON component arrays preserve missing values, duplicate identities and the
// original evidence. CSV quoting and formula protection serve different jobs.
export function sbomComparisonCsv(baselineId: number, currentId: number, rows: ComponentDifference[]): string {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return [
    ['baseline_sbom_id', 'current_sbom_id', 'component_name', 'supplier', 'change_type', 'changed_fields', 'baseline_rows', 'current_rows', 'baseline_components_json', 'current_components_json'],
    ...rows.map(row => [baselineId, currentId, row.name, row.supplier, row.kind, row.fields.join(';'), row.baseline.length, row.current.length, JSON.stringify(row.baseline), JSON.stringify(row.current)]),
  ].map(row => row.map(cell).join(',')).join('\r\n');
}
