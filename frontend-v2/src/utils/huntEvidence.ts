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
