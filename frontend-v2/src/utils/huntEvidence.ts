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
