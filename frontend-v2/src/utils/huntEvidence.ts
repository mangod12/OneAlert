import type { HuntQueryResult } from '../components/HuntQueryEvidence';

export interface HuntEvidenceResult {
  session_id?: number;
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

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  let start = 0;
  while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++;
  const formula = typeof value === 'string' && '=+@-'.includes(text[start] ?? '\uffff');
  return `"${(formula ? `'${text}` : text).replace(/"/g, '""')}"`;
}

export function huntQueryCsv(result: HuntQueryResult, index: number): string {
  const rows = result.rows ?? [];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const table: unknown[][] = [['query_index', 'recorded_outcome', 'evidence_scope', ...columns.map(column => `event.${column}`)]];
  for (const row of rows) table.push([index + 1, result.outcome ?? 'not recorded', scope, ...columns.map(column => row[column])]);
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
