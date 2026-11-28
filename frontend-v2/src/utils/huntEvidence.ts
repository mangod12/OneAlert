import type { HuntQueryResult } from '../components/HuntQueryEvidence';

export interface HuntEvidenceResult {
  reviewed_draft?: { session_id: number; fingerprint: string; query_numbers: number[]; scope: string };
  session_id?: number;
  agent_run_id?: number | null;
  hypothesis?: string;
  status?: string;
  recorded_at?: string;
  explanation?: string;
  error?: string;
  summary?: string;
  execution_summary?: { completed: number; rejected: number; failed: number; attempted: number; skipped: number };
  query_results?: HuntQueryResult[];
  sigma_rule?: string;
}

const scope = 'Retained saved hunt evidence only. No queries were rerun. Recorded rows are not confirmed threats; missing metadata is not inferred.';

export function huntEvidenceJson(result: HuntEvidenceResult, exportedAt: string): string {
  return JSON.stringify({ format: 'onealert_hunt_evidence_v1', exported_at: exportedAt, scope, result }, null, 2) + '\n';
}

export function huntQueryJson(result: HuntQueryResult, index: number, exportedAt: string, search?: { text: string; field: string | null; retained_total: number }): string {
  if (!Number.isSafeInteger(index) || index < 0) throw Error('Invalid retained query position');
  return JSON.stringify({ format: 'onealert.retained-hunt-query', version: 1, exported_at: exportedAt,
    query_position: index + 1, scope: scope + (search ? ' Only locally matching retained rows from this displayed query result, not all retained or reported rows.' : ' Only this displayed query result, not the full hunt.') + ' No upload, message or access grant sent.',
    ...(search ? { retained_search: { text: search.text, field: search.field, retained_total: search.retained_total } } : {}),
    result: { ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
      ...(result.query !== undefined ? { query: result.query } : {}),
      ...(result.execution !== undefined ? { execution: result.execution } : {}),
      ...(result.time_window !== undefined ? { time_window: result.time_window } : {}),
      ...(result.row_count !== undefined ? { reported_row_count: result.row_count } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.rows !== undefined ? { rows: result.rows } : {}) } }, null, 2) + '\n';
}

export function huntRowJson(result: HuntQueryResult, index: number, rowNumber: number, exportedAt: string): string {
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || !result.rows || rowNumber > result.rows.length) throw Error('Invalid retained row position');
  const queryEvidence = JSON.parse(huntQueryJson({ ...result, rows: [result.rows[rowNumber - 1]] }, index, exportedAt));
  return JSON.stringify({ ...queryEvidence, format: 'onealert.retained-hunt-row', retained_row_position: rowNumber, retained_total: result.rows.length,
    scope: scope + ' Only one retained row at its original saved position in this displayed query, not all retained or reported rows. Recorded query counts and context are unchanged. No upload, message or access grant sent.' }, null, 2) + '\n';
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  let start = 0;
  while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++;
  const formula = typeof value === 'string' && '=+@-'.includes(text[start] ?? '\uffff');
  return `"${(formula ? `'${text}` : text).replace(/"/g, '""')}"`;
}

export function huntRowFieldsJson(result: HuntQueryResult, index: number, rowNumber: number, exportedAt: string): string {
  const evidence = JSON.parse(huntRowJson(result, index, rowNumber, exportedAt));
  const row = result.rows![rowNumber - 1];
  return JSON.stringify({ format: 'onealert.retained-hunt-row-fields', version: 1, exported_at: exportedAt, query_position: index + 1,
    retained_row_position: rowNumber, retained_total: result.rows!.length, recorded_field_count: Object.keys(row).length,
    scope: scope + ' Every recorded field of one original retained row, regardless of local field search, type focus, name order or page. Absent fields are not inferred. Null, array order and JSON types are preserved. No upload, message or access grant is sent. Raw field values and query context may contain sensitive telemetry; review before sharing.',
    query_context: { ...evidence.result, rows: undefined }, fields: Object.entries(row).map(([field, value]) => ({ field, recorded_type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value, value })) }, null, 2) + '\n';
}
export function huntRowFieldInspectionJson(result: HuntQueryResult, index: number, rowNumber: number, exportedAt: string, inspection: { search: string; search_target?: string; type: string; coverage: string; order: string; fields: string[] }): string {
  const evidence = JSON.parse(huntRowFieldsJson(result, index, rowNumber, exportedAt));
  const row = result.rows![rowNumber - 1];
  const names = [...new Set(inspection.fields)];
  if (names.some(name => !Object.hasOwn(row, name))) throw Error('Invalid inspected field selection');
  const fields = names.map(name => ({ ...evidence.fields.find((item: { field: string }) => item.field === name), present_retained_count: result.rows!.filter(item => Object.hasOwn(item, name)).length, missing_retained_count: retainedHuntMissingRows(result.rows!, name).length }));
  return JSON.stringify({ ...evidence, format: 'onealert.retained-hunt-row-field-inspection', matching_field_count: fields.length, inspection: { search: inspection.search, search_target: inspection.search_target ?? 'both', type: inspection.type, coverage: inspection.coverage, order: inspection.order }, fields,
    scope: scope + ' Only current locally matching inspected fields of this original retained row across all field pages, in current field order. Search, type, coverage and order are explicit. Coverage counts use all retained rows; recorded null is present, not missing. Other fields and unretained reported rows are excluded. Query context and reported counts are unchanged. Raw JSON has no spreadsheet formula protection. Review sensitive telemetry and query context before sharing. No upload, message or access grant is sent.' }, null, 2) + '\n';
}

export function huntRowFieldInspectionCsv(result: HuntQueryResult, index: number, rowNumber: number, inspection: Parameters<typeof huntRowFieldInspectionJson>[4]): string {
  const evidence = JSON.parse(huntRowFieldInspectionJson(result, index, rowNumber, '', inspection));
  const table: unknown[][] = [['query_position', 'retained_row_position', 'retained_total', 'reported_row_count', 'recorded_field_count', 'matching_field_count', 'inspection_search', 'inspection_search_target', 'inspection_type', 'inspection_coverage', 'inspection_order', 'field_present', 'field', 'recorded_type', 'value_json', 'present_retained_count', 'missing_retained_count', 'evidence_scope']];
  const prefix = [index + 1, rowNumber, evidence.retained_total, result.row_count, evidence.recorded_field_count, evidence.matching_field_count, inspection.search, inspection.search_target ?? 'both', inspection.type, inspection.coverage, inspection.order];
  const csvScope = scope + ' Current locally matching inspected fields across all field pages in current field order. Coverage counts use all retained rows, not reported totals; null is present. One field per record with JSON value; empty matches produce one field_present=false summary record. Formula-like text cells are escaped. Full query context remains in JSON. Review sensitive telemetry before sharing; no upload, message or access grant is sent.';
  if (!evidence.fields.length) table.push([...prefix, false, '', '', '', '', '', csvScope]);
  for (const field of evidence.fields) table.push([...prefix, true, field.field, field.recorded_type, JSON.stringify(field.value), field.present_retained_count, field.missing_retained_count, csvScope]);
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function huntRowFieldsCsv(result: HuntQueryResult, index: number, rowNumber: number): string {
  const evidence = JSON.parse(huntRowFieldsJson(result, index, rowNumber, ''));
  const table: unknown[][] = [['query_position', 'retained_row_position', 'retained_total', 'reported_row_count', 'recorded_field_count', 'field', 'recorded_type', 'value_json', 'evidence_scope']];
  for (const field of evidence.fields) table.push([index + 1, rowNumber, evidence.retained_total, result.row_count, evidence.recorded_field_count, field.field, field.recorded_type, JSON.stringify(field.value), evidence.scope]);
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function huntQueryCsv(result: HuntQueryResult, index: number, search?: { text: string; field: string | null; retained_total: number }): string {
  const rows = result.rows ?? [];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const searchColumns = search ? ['retained_search_text', 'retained_search_field', 'retained_total_before_search'] : [];
  const table: unknown[][] = [['query_index', 'recorded_outcome', 'evidence_scope', ...searchColumns, ...columns.map(column => `event.${column}`)]];
  for (const row of rows) table.push([index + 1, result.outcome ?? 'not recorded', search ? `${scope} This export contains only matching retained rows, not all reported or retained evidence.` : scope, ...(search ? [search.text, search.field || '(all retained fields)', search.retained_total] : []), ...columns.map(column => row[column])]);
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function saveHuntDownload(content: string, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to begin reading the object URL before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}


export function compareRetainedHuntRows(baseline: Record<string, unknown>, inspected: Record<string, unknown>) {
  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]));
    const left = Object.keys(a), right = Object.keys(b);
    return left.length === right.length && left.every(key => Object.hasOwn(b, key) && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  };
  return [...new Set([...Object.keys(baseline), ...Object.keys(inspected)])].map(field => {
    const baselinePresent = Object.hasOwn(baseline, field), inspectedPresent = Object.hasOwn(inspected, field);
    return { field, baselinePresent, inspectedPresent, baseline: baseline[field], inspected: inspected[field],
      status: !baselinePresent ? 'Only in inspected row' : !inspectedPresent ? 'Only in baseline row' : same(baseline[field], inspected[field]) ? 'Same recorded value' : 'Different recorded value' };
  });
}


export function huntRowComparisonJson(result: HuntQueryResult, index: number, baselineRow: number, inspectedRow: number, exportedAt: string): string {
  if (baselineRow === inspectedRow) throw Error('Choose different retained row positions');
  const baseline = JSON.parse(huntRowJson(result, index, baselineRow, exportedAt));
  const inspected = JSON.parse(huntRowJson(result, index, inspectedRow, exportedAt));
  return JSON.stringify({ format: 'onealert.retained-hunt-row-comparison', version: 1, exported_at: exportedAt, query_position: index + 1, retained_total: result.rows!.length,
    scope: scope + ' Only two retained rows from the same displayed query. They may be different events, not versions of one event. No chronology, cause, threat verdict, upload, message or access grant is inferred or sent. All recorded fields are included regardless of local comparison focus or hidden columns.',
    baseline: { retained_row_position: baselineRow, row: baseline.result.rows[0] }, inspected: { retained_row_position: inspectedRow, row: inspected.result.rows[0] },
    query_context: { ...baseline.result, rows: undefined }, fields: compareRetainedHuntRows(result.rows![baselineRow - 1], result.rows![inspectedRow - 1]) }, null, 2) + '\n';
}


export function huntComparisonInspectionJson(result: HuntQueryResult, index: number, baselineRow: number, inspectedRow: number, exportedAt: string, inspection: { search: string; status: string; type: string; order: string; differences_only: boolean; fields: string[] }): string {
  const pair = JSON.parse(huntRowComparisonJson(result, index, baselineRow, inspectedRow, exportedAt));
  const compared = compareRetainedHuntRows(result.rows![baselineRow - 1], result.rows![inspectedRow - 1]);
  const selected = [...new Set(inspection.fields)].map(field => { const item = compared.find(item => item.field === field); if (!item) throw Error('Choose a compared retained field'); return item; });
  return JSON.stringify({ format: 'onealert.retained-hunt-comparison-inspection', version: 1, exported_at: exportedAt, query_position: index + 1, retained_total: result.rows!.length, baseline_retained_position: baselineRow, inspected_retained_position: inspectedRow, compared_field_count: compared.length, matching_field_count: selected.length,
    inspection: { search: inspection.search, status: inspection.status, type: inspection.type, order: inspection.order, differences_only: inspection.differences_only },
    scope: scope + ' Only locally matching compared fields across every comparison page, in current order. Full source rows and other compared fields are excluded. Original positions and recorded query context are unchanged. Missing fields differ from recorded null. These may be different events, not versions of one event. No chronology, cause, threat verdict, upload, message or access grant is inferred or sent.',
    query_context: pair.query_context, fields: selected }, null, 2) + '\n';
}


export function huntRowComparisonCsv(result: HuntQueryResult, index: number, baselineRow: number, inspectedRow: number): string {
  // Reuse the JSON export validation and context contract before producing a table.
  const evidence = JSON.parse(huntRowComparisonJson(result, index, baselineRow, inspectedRow, ''));
  const table: unknown[][] = [['query_position', 'baseline_retained_position', 'inspected_retained_position', 'retained_total', 'reported_row_count', 'evidence_scope', 'field', 'comparison', 'baseline_present', 'baseline_json', 'inspected_present', 'inspected_json']];
  for (const item of compareRetainedHuntRows(result.rows![baselineRow - 1], result.rows![inspectedRow - 1])) {
    table.push([index + 1, baselineRow, inspectedRow, result.rows!.length, result.row_count, evidence.scope, item.field, item.status, item.baselinePresent, item.baselinePresent ? JSON.stringify(item.baseline) : '', item.inspectedPresent, item.inspectedPresent ? JSON.stringify(item.inspected) : '']);
  }
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}


export function retainedHuntFieldProfile(rows: Record<string, unknown>[], field: string) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  let missing = 0, nulls = 0;
  const values = new Map<string, { value: unknown; count: number; firstRow: number }>();
  rows.forEach((row, index) => {
    if (!Object.hasOwn(row, field)) { missing++; return; }
    const value = row[field];
    if (value === null) nulls++;
    const key = JSON.stringify(canonical(value));
    const found = values.get(key);
    if (found) found.count++;
    else values.set(key, { value, count: 1, firstRow: index + 1 });
  });
  return { total: rows.length, present: rows.length - missing, missing, nulls, distinct: values.size, values: [...values.values()].sort((a, b) => b.count - a.count || a.firstRow - b.firstRow) };
}


export function huntFieldProfileJson(result: HuntQueryResult, index: number, field: string, exportedAt: string): string {
  if (!result.rows?.some(row => Object.hasOwn(row, field))) throw Error('Choose a recorded retained field');
  const query = JSON.parse(huntQueryJson(result, index, exportedAt));
  return JSON.stringify({ format: 'onealert.retained-hunt-field-profile', version: 1, exported_at: exportedAt, query_position: index + 1, field,
    scope: scope + ' All retained rows for this field regardless of local search, focus, hidden columns or displayed profile limit. Not all reported events or a current distribution. JSON types and array order are preserved; object key order is ignored. Values are frequency ordered, ties use first retained position. No upload, message or access grant sent.',
    query_context: { ...query.result, rows: undefined }, profile: retainedHuntFieldProfile(result.rows, field) }, null, 2) + '\n';
}


export function retainedHuntValueRows(rows: Record<string, unknown>[], field: string, firstRow: number): number[] {
  if (!Number.isSafeInteger(firstRow) || firstRow < 1 || firstRow > rows.length || !Object.hasOwn(rows[firstRow - 1], field)) return [];
  const value = rows[firstRow - 1][field];
  return rows.flatMap((row, index) => Object.hasOwn(row, field) && compareRetainedHuntRows({ value }, { value: row[field] })[0].status === 'Same recorded value' ? [index + 1] : []);
}


export function retainedHuntMissingRows(rows: Record<string, unknown>[], field: string): number[] {
  return rows.flatMap((row, index) => Object.hasOwn(row, field) ? [] : [index + 1]);
}


export function huntProfileMatchesJson(result: HuntQueryResult, index: number, field: string, selection: { kind: 'missing' } | { kind: 'value'; firstRow: number }, exportedAt: string): string {
  if (!result.rows?.some(row => Object.hasOwn(row, field))) throw Error('Choose a recorded retained field');
  const positions = selection.kind === 'missing' ? retainedHuntMissingRows(result.rows, field) : retainedHuntValueRows(result.rows, field, selection.firstRow);
  if (!positions.length) throw Error('No matching retained rows');
  const query = JSON.parse(huntQueryJson(result, index, exportedAt));
  return JSON.stringify({ format: 'onealert.retained-hunt-profile-matches', version: 1, exported_at: exportedAt, query_position: index + 1, field, retained_total: result.rows.length,
    selection: selection.kind === 'missing' ? { kind: 'missing' } : { kind: 'value', first_retained_position: selection.firstRow, value: result.rows[selection.firstRow - 1][field] },
    scope: scope + ' Only retained rows matching this exact typed profile selection, across all local pages. Missing fields differ from recorded null. Original positions and recorded query context are unchanged. No upload, message or access grant sent.',
    query_context: { ...query.result, rows: undefined }, matched_retained_count: positions.length, rows: positions.map(position => ({ retained_row_position: position, row: result.rows![position - 1] })) }, null, 2) + '\n';
}


export function huntFieldProfileCsv(result: HuntQueryResult, index: number, field: string): string {
  const evidence = JSON.parse(huntFieldProfileJson(result, index, field, ''));
  const profile = retainedHuntFieldProfile(result.rows!, field);
  const table: unknown[][] = [['query_position', 'field', 'retained_total', 'reported_row_count', 'present_count', 'missing_count', 'recorded_null_count', 'distinct_count', 'evidence_scope', 'value_json', 'retained_count', 'first_retained_position']];
  for (const item of profile.values) table.push([index + 1, field, profile.total, result.row_count, profile.present, profile.missing, profile.nulls, profile.distinct, evidence.scope, JSON.stringify(item.value), item.count, item.firstRow]);
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}


export function huntProfileMatchesCsv(result: HuntQueryResult, index: number, field: string, selection: { kind: 'missing' } | { kind: 'value'; firstRow: number }): string {
  const evidence = JSON.parse(huntProfileMatchesJson(result, index, field, selection, ''));
  const positions = selection.kind === 'missing' ? retainedHuntMissingRows(result.rows!, field) : retainedHuntValueRows(result.rows!, field, selection.firstRow);
  const columns = [...new Set(positions.flatMap(position => Object.keys(result.rows![position - 1])))];
  const table: unknown[][] = [['query_position', 'profile_field', 'selection_kind', 'selected_value_json', 'retained_total', 'matched_retained_count', 'reported_row_count', 'retained_row_position', 'evidence_scope', ...columns.flatMap(column => [`event.${column}.present`, `event.${column}.json`])]];
  for (const position of positions) {
    const row = result.rows![position - 1];
    table.push([index + 1, field, selection.kind, selection.kind === 'value' ? JSON.stringify(result.rows![selection.firstRow - 1][field]) : '', result.rows!.length, positions.length, result.row_count, position, evidence.scope, ...columns.flatMap(column => [Object.hasOwn(row, column), Object.hasOwn(row, column) ? JSON.stringify(row[column]) : ''])]);
  }
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}


export function huntFieldCoverageJson(result: HuntQueryResult, index: number, exportedAt: string): string {
  if (!result.rows?.length) throw Error('No retained rows');
  const columns = [...new Set(result.rows.flatMap(row => Object.keys(row)))];
  if (!columns.length) throw Error('No recorded fields');
  const query = JSON.parse(huntQueryJson(result, index, exportedAt));
  return JSON.stringify({ format: 'onealert.retained-hunt-field-coverage', version: 1, exported_at: exportedAt, query_position: index + 1, retained_total: result.rows.length,
    scope: scope + ' All recorded fields across all retained rows, regardless of coverage search, page, profile selection, row search or hidden columns. Present includes recorded null. Missing differs from null. Distinct counts preserve JSON types and array order; object key order is ignored. Not all reported events or current data. No upload, message or access grant sent.',
    query_context: { ...query.result, rows: undefined }, fields: columns.map(field => { const profile = retainedHuntFieldProfile(result.rows!, field); return { field, present: profile.present, missing: profile.missing, recorded_null: profile.nulls, distinct: profile.distinct }; }) }, null, 2) + '\n';
}

export function huntFieldCoverageCsv(result: HuntQueryResult, index: number): string {
  const evidence = JSON.parse(huntFieldCoverageJson(result, index, ''));
  const table: unknown[][] = [['query_position', 'retained_total', 'reported_row_count', 'evidence_scope', 'field', 'present_count', 'missing_count', 'recorded_null_count', 'distinct_count']];
  for (const field of evidence.fields) table.push([index + 1, result.rows!.length, result.row_count, evidence.scope, field.field, field.present, field.missing, field.recorded_null, field.distinct]);
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function huntComparedFieldJson(result: HuntQueryResult, index: number, baselineRow: number, inspectedRow: number, field: string, exportedAt: string): string {
  const pair = JSON.parse(huntRowComparisonJson(result, index, baselineRow, inspectedRow, exportedAt));
  const selected = compareRetainedHuntRows(result.rows![baselineRow - 1], result.rows![inspectedRow - 1]).find(item => item.field === field);
  if (!selected) throw Error('Choose a field recorded in at least one compared row');
  return JSON.stringify({ format: 'onealert.retained-hunt-compared-field', version: 1, exported_at: exportedAt, query_position: index + 1,
    retained_total: pair.retained_total, baseline_retained_position: baselineRow, inspected_retained_position: inspectedRow,
    scope: 'One exact named field from two original retained row positions in this query, including recorded presence, JSON types and values. Missing is not null. This is not event identity, chronology, a threat verdict or live data. Other row fields are excluded, but recorded query context may contain sensitive telemetry. Review before sharing. Raw JSON has no spreadsheet formula protection. Downloading sends nothing to another person.',
    query_context: pair.query_context, field: selected }, null, 2) + '\n';
}

export function huntComparedFieldCsv(result: HuntQueryResult, index: number, baselineRow: number, inspectedRow: number, field: string): string {
  const evidence = JSON.parse(huntComparedFieldJson(result, index, baselineRow, inspectedRow, field, ''));
  const item = evidence.field;
  const table: unknown[][] = [['query_position', 'baseline_retained_position', 'inspected_retained_position', 'retained_total', 'reported_row_count', 'evidence_scope', 'field', 'comparison', 'baseline_present', 'baseline_json', 'inspected_present', 'inspected_json'],
    [index + 1, baselineRow, inspectedRow, evidence.retained_total, result.row_count, 'One exact compared field from two retained positions only. Presence distinguishes missing from null. JSON types and values are preserved; text formulas are escaped. No live data, chronology or event identity is inferred. Recorded query context is available in JSON only. Review sensitive values before sharing; downloading sends nothing to another person.', field, item.status, item.baselinePresent, item.baselinePresent ? JSON.stringify(item.baseline) : '', item.inspectedPresent, item.inspectedPresent ? JSON.stringify(item.inspected) : '']];
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}


export function huntProfileValueJson(result: HuntQueryResult, index: number, field: string, firstRow: number, exportedAt: string): string {
  const positions = retainedHuntValueRows(result.rows ?? [], field, firstRow);
  if (!positions.length || positions[0] !== firstRow) throw Error('Choose the first original retained position of a recorded profile value');
  const query = JSON.parse(huntQueryJson(result, index, exportedAt));
  const value = result.rows![firstRow - 1][field];
  return JSON.stringify({ format: 'onealert.retained-hunt-profile-value', version: 1, exported_at: exportedAt, query_position: index + 1, field,
    retained_total: result.rows!.length, matching_retained_count: positions.length, first_retained_position: firstRow,
    recorded_type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value, value,
    scope: 'One exact typed recorded value and its frequency across retained rows for this field. Original first position, not event identity or chronology. Object key order is ignored for matching; array order and JSON types stay distinct. Missing is not recorded null. Other values and row fields are excluded, but unchanged recorded query context may contain sensitive telemetry. Review before sharing. Raw JSON has no spreadsheet formula protection. No live lookup, upload, message or access grant sent.',
    query_context: { ...query.result, rows: undefined } }, null, 2) + '\n';
}


export function huntProfileValueCsv(result: HuntQueryResult, index: number, field: string, firstRow: number): string {
  const evidence = JSON.parse(huntProfileValueJson(result, index, field, firstRow, ''));
  const table: unknown[][] = [['query_position', 'profile_field', 'recorded_type', 'value_json', 'matching_retained_count', 'retained_total', 'first_retained_position', 'reported_row_count', 'evidence_scope'],
    [index + 1, field, evidence.recorded_type, JSON.stringify(evidence.value), evidence.matching_retained_count, evidence.retained_total, evidence.first_retained_position, result.row_count,
      'One exact typed value and frequency across retained rows only. Object key order is ignored; array order and JSON types stay distinct. Missing is not null. Original position is not event identity or chronology. Other values and row fields are excluded. Full query context is available in JSON only. Text formulas are escaped. Review sensitive values before sharing; downloading sends nothing to another person.']];
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}


export function huntProfileReviewJson(result: HuntQueryResult, index: number, field: string, review: { search: string; type: string; frequency: string; order: string }, exportedAt: string): string {
  if (!['all', 'null', 'string', 'number', 'boolean', 'array', 'object'].includes(review.type) || !['all', 'once', 'repeated'].includes(review.frequency) || !['frequent', 'rare', 'retained'].includes(review.order)) throw Error('Invalid retained profile review focus');
  const full = JSON.parse(huntFieldProfileJson(result, index, field, exportedAt));
  const needle = review.search.trim().toLowerCase();
  const values = retainedHuntFieldProfile(result.rows!, field).values.filter(item => (review.type === 'all' || (item.value === null ? 'null' : Array.isArray(item.value) ? 'array' : typeof item.value) === review.type) && (review.frequency === 'all' || (review.frequency === 'once' ? item.count === 1 : item.count > 1)) && (!needle || JSON.stringify(item.value)?.toLowerCase().includes(needle)));
  values.sort((a, b) => review.order === 'rare' ? a.count - b.count || a.firstRow - b.firstRow : review.order === 'retained' ? a.firstRow - b.firstRow : b.count - a.count || a.firstRow - b.firstRow);
  return JSON.stringify({ format: 'onealert.retained-hunt-profile-review', version: 1, exported_at: exportedAt, query_position: index + 1, field,
    scope: 'Only distinct recorded values matching the explicit local profile review focus, across every matching value page. Frequencies use all retained rows for this field, not filtered rows, all reported events or current data. Excludes nonmatching values and source rows. Missing differs from recorded null. JSON types and array order stay distinct; object key order is ignored. This is not a threat verdict. Recorded query context may contain sensitive telemetry. Review before sharing; raw JSON has no spreadsheet formula protection. Downloading sends nothing to another person.',
    review: { ...review }, full_retained_summary: { total: full.profile.total, present: full.profile.present, missing: full.profile.missing, recorded_null: full.profile.nulls, distinct: full.profile.distinct },
    matching_distinct_count: values.length, matching_retained_count: values.reduce((sum, item) => sum + item.count, 0), query_context: full.query_context, values }, null, 2) + '\n';
}


export function huntProfileReviewCsv(result: HuntQueryResult, index: number, field: string, review: { search: string; type: string; frequency: string; order: string }): string {
  const evidence = JSON.parse(huntProfileReviewJson(result, index, field, review, ''));
  const summary = evidence.full_retained_summary;
  const table: unknown[][] = [['query_position', 'profile_field', 'review_search', 'review_type', 'review_frequency', 'review_order', 'retained_total', 'present_count', 'missing_count', 'recorded_null_count', 'full_distinct_count', 'matching_distinct_count', 'matching_retained_count', 'reported_row_count', 'value_present', 'recorded_type', 'value_json', 'retained_frequency', 'first_retained_position', 'evidence_scope']];
  const scope = 'Only distinct values matching the explicit profile review across all value pages. Frequencies use all retained rows for this field, not filtered rows, reported events or current data. No source rows or nonmatching values. Missing is not null; JSON types and array order stay distinct, object key order is ignored. Original position is not event identity or chronology. Text formulas are escaped. Full query context is in JSON only. Review sensitive values before sharing; downloading sends nothing to another person.';
  for (const item of evidence.values.length ? evidence.values : [null]) {
    const type = item ? item.value === null ? 'null' : Array.isArray(item.value) ? 'array' : typeof item.value : '';
    table.push([index + 1, field, review.search, review.type, review.frequency, review.order, summary.total, summary.present, summary.missing, summary.recorded_null, summary.distinct, evidence.matching_distinct_count, evidence.matching_retained_count, result.row_count, item !== null, type, item ? JSON.stringify(item.value) : '', item ? item.count : '', item ? item.firstRow : '', scope]);
  }
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}


export function huntProfileReviewRowsJson(result: HuntQueryResult, index: number, field: string, review: { search: string; type: string; frequency: string; order: string }, exportedAt: string): string {
  const evidence = JSON.parse(huntProfileReviewJson(result, index, field, review, exportedAt));
  const positions = [...new Set<number>(evidence.values.flatMap((item: { firstRow: number }) => retainedHuntValueRows(result.rows!, field, item.firstRow)))].sort((a, b) => a - b);
  return JSON.stringify({ ...evidence, format: 'onealert.retained-hunt-profile-review-rows',
    scope: 'Full recorded fields of every retained row represented by the explicit profile review, across all value and row pages, in original retained position order. Review value order does not reorder rows. Missing profile fields are excluded; recorded null and JSON types are preserved. Frequencies use all retained rows for this field, not reported events or current data. Includes recorded query context and potentially sensitive telemetry from every matching row. Review before sharing. Raw JSON has no spreadsheet formula protection. No new lookup, event identity, chronology, threat verdict, upload, message or access grant is inferred or sent.',
    rows: positions.map(position => ({ retained_row_position: position, row: result.rows![position - 1] })) }, null, 2) + '\n';
}


export function huntProfileReviewRowsCsv(result: HuntQueryResult, index: number, field: string, review: { search: string; type: string; frequency: string; order: string }): string {
  const evidence = JSON.parse(huntProfileReviewRowsJson(result, index, field, review, ''));
  const summary = evidence.full_retained_summary;
  const table: unknown[][] = [['query_position', 'profile_field', 'review_search', 'review_type', 'review_frequency', 'review_order', 'retained_total', 'present_count', 'missing_count', 'recorded_null_count', 'full_distinct_count', 'matching_distinct_count', 'matching_retained_count', 'reported_row_count', 'row_present', 'retained_row_position', 'row_json', 'evidence_scope']];
  const scope = 'Full recorded rows represented by the explicit profile review across all value and row pages, in original retained position order regardless of review value order. Missing profile fields and nonmatching rows are excluded. Recorded null and JSON types preserved inside row_json. Counts use all retained rows, not reported events or current data. Contains sensitive hidden row fields. Text formulas are escaped; full recorded query context is in JSON only. Original position is not event identity, chronology or a threat verdict. Review before sharing; downloading sends nothing to another person.';
  for (const item of evidence.rows.length ? evidence.rows : [null]) table.push([index + 1, field, review.search, review.type, review.frequency, review.order, summary.total, summary.present, summary.missing, summary.recorded_null, summary.distinct, evidence.matching_distinct_count, evidence.matching_retained_count, result.row_count, item !== null, item ? item.retained_row_position : '', item ? JSON.stringify(item.row) : '', scope]);
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}


export function huntProfileRowInspectionJson(result: HuntQueryResult, index: number, field: string, review: { search: string; type: string; frequency: string; order: string }, inspection: { field: string; type: string; search: string }, exportedAt: string): string {
  if (!['all', 'missing', 'null', 'string', 'number', 'boolean', 'array', 'object'].includes(inspection.type) || (!inspection.field && inspection.type !== 'all') || (inspection.field && !(result.rows ?? []).some(row => Object.hasOwn(row, inspection.field)))) throw Error('Invalid represented row inspection');
  const evidence = JSON.parse(huntProfileReviewRowsJson(result, index, field, review, exportedAt));
  const needle = inspection.search.trim().toLowerCase();
  const rows = evidence.rows.filter((item: { row: Record<string, unknown> }) => {
    const present = Object.hasOwn(item.row, inspection.field);
    const value = item.row[inspection.field];
    const type = present ? value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value : 'missing';
    return (!inspection.field || inspection.type === 'all' || type === inspection.type) && (!needle || (inspection.field ? present && JSON.stringify(value)?.toLowerCase().includes(needle) : JSON.stringify(item.row).toLowerCase().includes(needle)));
  });
  return JSON.stringify({ ...evidence, format: 'onealert.retained-hunt-profile-row-inspection',
    scope: 'Only retained rows matching both the explicit profile review and explicit local row inspection, across every matching row page, in original retained position order. Full recorded row fields and unchanged query context may include sensitive telemetry. Profile review counts and values describe the pre-inspection represented basis; matching_inspection_row_count describes this download. Missing field differs from recorded null; nonempty text excludes missing. No current data, chronology, event identity or threat verdict is inferred. Review before sharing. Raw JSON has no spreadsheet formula protection. Downloading sends nothing to another person.',
    inspection: { ...inspection }, matching_inspection_row_count: rows.length, rows }, null, 2) + '\n';
}


export function huntProfileRowInspectionCsv(result: HuntQueryResult, index: number, field: string, review: { search: string; type: string; frequency: string; order: string }, inspection: { field: string; type: string; search: string }): string {
  const evidence = JSON.parse(huntProfileRowInspectionJson(result, index, field, review, inspection, ''));
  const summary = evidence.full_retained_summary;
  const table: unknown[][] = [['query_position', 'profile_field', 'review_search', 'review_type', 'review_frequency', 'review_order', 'inspection_field', 'inspection_type', 'inspection_search', 'retained_total', 'present_count', 'missing_count', 'recorded_null_count', 'full_distinct_count', 'matching_distinct_count', 'matching_retained_count', 'matching_inspection_row_count', 'reported_row_count', 'row_present', 'retained_row_position', 'row_json', 'evidence_scope']];
  const scope = 'Only rows matching both explicit profile review and local row inspection across every matching page, in original retained position order. Full hidden recorded fields and JSON types remain inside row_json. Profile review counts describe the pre-inspection represented basis; matching_inspection_row_count describes this download. Missing field is not recorded null; nonempty text excludes missing. An empty inspection has one summary record with row_present=false. Text formulas are escaped; full query context is in JSON only. No current data, event identity, chronology or threat verdict is inferred. Review sensitive telemetry before sharing; downloading sends nothing to another person.';
  for (const item of evidence.rows.length ? evidence.rows : [null]) table.push([index + 1, field, review.search, review.type, review.frequency, review.order, inspection.field, inspection.type, inspection.search, summary.total, summary.present, summary.missing, summary.recorded_null, summary.distinct, evidence.matching_distinct_count, evidence.matching_retained_count, evidence.matching_inspection_row_count, result.row_count, item !== null, item ? item.retained_row_position : '', item ? JSON.stringify(item.row) : '', scope]);
  return '\ufeff' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
