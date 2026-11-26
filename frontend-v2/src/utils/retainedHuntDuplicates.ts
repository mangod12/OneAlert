import type { HuntQueryResult } from '../components/HuntQueryEvidence';
import { huntQueryJson } from './huntEvidence';

// Compare full retained row values, not event identities or live data.
export function retainedHuntDuplicateGroups(rows: Record<string, unknown>[]): number[][] {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = JSON.stringify(canonical(row));
    const positions = groups.get(key);
    if (positions) positions.push(index + 1);
    else groups.set(key, [index + 1]);
  });
  return [...groups.values()].filter(positions => positions.length > 1);
}

export function huntRepeatedRowsJson(result: HuntQueryResult, index: number, exportedAt: string): string {
  const query = JSON.parse(huntQueryJson(result, index, exportedAt));
  const rows = result.rows ?? [];
  const groups = retainedHuntDuplicateGroups(rows);
  return JSON.stringify({ format: 'onealert.retained-hunt-repeated-rows', version: 1, exported_at: exportedAt, query_position: index + 1, retained_total: rows.length,
    repeated_group_count: groups.length, repeated_position_count: groups.reduce((total, group) => total + group.length, 0),
    scope: 'Exact full-row JSON values across all retained positions only, regardless of local search, hidden columns, order or group page. Object key order is ignored; JSON types, missing fields and array order are preserved. Repeated values do not prove duplicate events, repeated ingestion or a threat. No evidence is removed, no query is rerun and no upload, message or access grant is sent. Raw row values may contain sensitive telemetry; review before sharing.',
    query_context: { ...query.result, rows: undefined }, groups: groups.map(positions => ({ first_retained_position: positions[0], retained_count: positions.length, retained_positions: positions, row: rows[positions[0] - 1] })) }, null, 2) + '\n';
}

export function huntRepeatedRowsCsv(result: HuntQueryResult, index: number): string {
  const evidence = JSON.parse(huntRepeatedRowsJson(result, index, ''));
  const table: unknown[][] = [['query_position', 'retained_total', 'reported_row_count', 'repeated_group_count', 'repeated_position_count', 'first_retained_position', 'group_retained_count', 'retained_positions_json', 'row_json', 'evidence_scope']];
  for (const positions of retainedHuntDuplicateGroups(result.rows ?? [])) table.push([index + 1, evidence.retained_total, result.row_count, evidence.repeated_group_count, evidence.repeated_position_count, positions[0], positions.length, JSON.stringify(positions), JSON.stringify(result.rows![positions[0] - 1]), evidence.scope]);
  const cell = (value: unknown): string => {
    const text = value == null ? '' : String(value);
    let start = 0;
    while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++;
    const safe = typeof value === 'string' && '=+@-'.includes(text[start] ?? '\uffff') ? "'" + text : text;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return '\ufeff' + table.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
