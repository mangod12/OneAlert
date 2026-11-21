interface ExportTechnique { id: string; name: string; tactics: string[]; description: string; }
function cell(value: string): string {
  let start = 0;
  while (start < value.length && (value.charCodeAt(start) <= 32 || /\s/u.test(value[start]))) start++;
  const safe = '=+@-'.includes(value[start] ?? '\uffff') ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function mitreCsv(techniques: ExportTechnique[], coveredIds: string[] | undefined, search: string, gapsOnly: boolean): string {
  const covered = coveredIds ? new Set(coveredIds) : null;
  const rows = [['technique_id', 'name', 'tactics', 'description', 'recorded_coverage', 'scope_search', 'scope_gaps_only', 'evidence_scope']];
  for (const technique of techniques) rows.push([technique.id, technique.name, technique.tactics.join('; '), technique.description, covered ? covered.has(technique.id) ? 'recorded_mapping' : 'no_recorded_mapping' : 'unknown', search, String(gapsOnly), 'loaded catalog subset and available mapping summary; case associations or enabled rules, not proof of tested detection, deployment or live protection']);
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
