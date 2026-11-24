import { validTaskDate } from './checklistTriage';
import type { WatchlistViewFilters } from './watchlistViews';
export interface WatchExportRecord { kind: 'alert' | 'case'; id: number; title: string; cve_id: string | null; asset_name: string | null; severity: string | null; status: string | null; created_at: string | null; due_date: string | null; }
export interface WatchPageExport { records: WatchExportRecord[]; page: number; total: number; dateBasis: string; filters: WatchlistViewFilters; loadedAt: string; capturedAt: string; }
export function watchlistPageSnapshot(value: unknown, page: number, filters: WatchlistViewFilters, loadedAt: string, capturedAt: string): WatchPageExport | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { data: WatchExportRecord[]; page: number; size: number; total: number; date_basis: string };
  if (!Number.isSafeInteger(page) || page < 1 || v.page !== page || v.size !== 25 || !Number.isSafeInteger(v.total) || v.total < 1 || !validTaskDate(v.date_basis) || !Array.isArray(v.data) || !v.data.length || v.data.length > 25 || v.total < (page - 1) * 25 + v.data.length || new Set(v.data.map(row => `${row?.kind}-${row?.id}`)).size !== v.data.length) return null;
  if (v.data.some(row => {
    if (!row || !['alert', 'case'].includes(row.kind) || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.title !== 'string'
      || [row.cve_id, row.asset_name, row.severity, row.status].some(field => field !== null && typeof field !== 'string')
      || (row.created_at !== null && (typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))))
      || (row.due_date !== null && !validTaskDate(row.due_date)) || (filters.kind !== 'all' && row.kind !== filters.kind) || (filters.severity !== 'all' && row.severity !== filters.severity)) return true;
    const done = ['resolved', 'closed', 'false_positive'].includes(row.status ?? '');
    return (filters.scope === 'active' && done) || (filters.scope === 'done' && !done) || (filters.scope === 'overdue' && (done || !row.due_date || row.due_date >= v.date_basis)) || (filters.scope === 'today' && (done || row.due_date !== v.date_basis)) || (filters.scope === 'future' && (done || !row.due_date || row.due_date <= v.date_basis)) || (filters.scope === 'undated' && (done || row.due_date !== null));
  })) return null;
  return { records: v.data.map(row => ({ ...row })), page, total: v.total, dateBasis: v.date_basis, filters: { ...filters }, loadedAt, capturedAt };
}
export function watchlistPageCsv(snapshot: WatchPageExport): string {
  const cell = (value: unknown) => { const text = String(value ?? ''); let start = 0; while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++; const safe = '=+@-'.includes(text[start] ?? '\uffff') ? "'" + text : text; return '"' + safe.replaceAll('"', '""') + '"'; };
  const f = snapshot.filters;
  const rows: unknown[][] = [['scope', 'captured_at', 'loaded_at', 'page', 'page_size', 'matching_total_at_read', 'utc_date_basis', 'title_query', 'record_type_filter', 'severity_filter', 'work_scope', 'sort', 'record_type', 'record_id', 'title', 'cve_id', 'asset_name', 'severity', 'status', 'created_at', 'due_date']];
  for (const row of snapshot.records) rows.push(['Only this loaded watchlist server page, not the full matching watchlist, watch history or audit evidence. Current records and follows can change. No message, upload, subscription or grant sent.', snapshot.capturedAt, snapshot.loadedAt, snapshot.page, 25, snapshot.total, snapshot.dateBasis, f.query, f.kind, f.severity, f.scope, f.sort, row.kind, row.id, row.title, row.cve_id, row.asset_name, row.severity, row.status, row.created_at, row.due_date]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
