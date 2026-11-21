type Kind = 'alert' | 'event';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
export function caseComparisonPackage(value: unknown, caseId: number, otherId: number, kind: Kind): string {
  const fail = () => { throw Error('Comparison export did not match the selected investigations or complete evidence sets. No file was saved.'); };
  if (!object(value)) return fail();
  if (value.format !== 'onealert_case_evidence_comparison_v1' || value.case_id !== caseId || value.other_case_id !== otherId || value.kind !== kind || ['case_title', 'other_case_title', 'exported_at', 'scope'].some(key => typeof value[key] !== 'string' || !value[key])) return fail();
  if (!integer(value.source_count) || !integer(value.other_count) || !integer(value.record_count) || (value.record_count as number) > 10000 || !object(value.records) || !object(value.set_counts)) return fail();
  const ids = new Set<number>();
  const records: Record<string, unknown[]> = {}, counts: Record<string, number> = {};
  for (const name of ['shared', 'source_only', 'other_only']) {
    const rows = value.records[name], count = value.set_counts[name];
    if (!Array.isArray(rows) || !integer(count) || count !== rows.length) return fail();
    counts[name] = count as number;
    records[name] = rows.map(row => {
      if (!object(row) || !integer(row.id) || (row.id as number) < 1 || ids.has(row.id as number) || typeof row.can_open_original !== 'boolean' || ['label', 'severity', 'recorded_at'].some(key => row[key] !== null && typeof row[key] !== 'string')) return fail();
      ids.add(row.id as number);
      return { id: row.id, label: row.label, severity: row.severity, recorded_at: row.recorded_at, can_open_original: row.can_open_original };
    });
  }
  if (ids.size !== value.record_count || counts.shared + counts.source_only !== value.source_count || counts.shared + counts.other_only !== value.other_count) return fail();
  return JSON.stringify({ format: value.format, exported_at: value.exported_at, kind,
    case_id: caseId, case_title: value.case_title, other_case_id: otherId, other_case_title: value.other_case_title,
    source_count: value.source_count, other_count: value.other_count, record_count: value.record_count,
    set_counts: counts, records, scope: value.scope }, null, 2) + '\n';
}
