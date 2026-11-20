import { useState } from 'react';
import { FileCode } from 'lucide-react';

type HuntRow = Record<string, unknown>;
export interface HuntQueryResult {
  query?: { description?: string; sql?: string; params?: Record<string, unknown> };
  execution?: { contract: string; selected_columns: string[]; order_by: string; direction: string; requested_limit: number | null; row_limit: number; tie_breaker?: { column: string; direction: string } | null };
  time_window?: { since?: string; before?: string };
  row_count?: number;
  rows?: HuntRow[];
  error?: string;
}
function cellText(value: unknown): string {
  if (value == null) return 'Not recorded';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function HuntQueryEvidence({ result, index }: { result: HuntQueryResult; index: number }) {
  const [page, setPage] = useState(1);
  const rows = result.rows ?? [];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = rows.slice((currentPage - 1) * 20, currentPage * 20);
  return <section aria-label={`Query ${index + 1} evidence`} className="mb-4 min-w-0 rounded-lg border border-surface-700 p-3 last:mb-0">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <FileCode className="h-4 w-4 shrink-0 text-primary-400" aria-hidden="true" />
      <h3 className="min-w-0 break-words text-sm font-medium text-surface-50">{result.query?.description || `Query ${index + 1}`}</h3>
    </div>
    <p className="mb-2 text-xs text-surface-400">{typeof result.row_count === 'number' ? `${result.row_count} results reported` : 'Result count not recorded'} · {rows.length} evidence rows retained</p>
    <p className="mb-3 text-xs text-surface-500">Recorded query output, not a new query or live check. Only retained rows can be reviewed here.</p>
    <pre className="mb-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-950 p-3 text-xs text-surface-400">{result.query?.sql || 'SQL not recorded'}</pre>
    {result.execution ? <div aria-label="Applied query execution" className="mb-3 space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300">
      <p className="font-semibold text-surface-100">Applied query execution</p>
      <p className="break-words">Selected fields: {result.execution.selected_columns.join(', ')}</p>
      <p>Order: {result.execution.order_by} {result.execution.direction}{result.execution.tie_breaker ? `, then ${result.execution.tie_breaker.column} ${result.execution.tie_breaker.direction}` : ''}</p>
      <p>Row limit: {result.execution.row_limit}{result.execution.requested_limit != null ? ` (requested ${result.execution.requested_limit})` : ' (default)'}</p>
      <p className="text-surface-400">Contract: {result.execution.contract}. Unsupported SQL is rejected, not silently dropped. Filters remain in the recorded SQL above and parameters below.</p>
    </div> : <p className="mb-3 text-xs text-surface-500">Applied selection, order and row limit were not recorded for this result.</p>}
    {result.time_window ? <div aria-label="Applied query time bounds" className="mb-3 space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300">
      <p className="font-semibold text-surface-100">Applied event-time bounds (UTC)</p>
      {result.time_window.since && <p className="break-all">From, inclusive: {result.time_window.since}</p>}
      {result.time_window.before && <p className="break-all">Before, exclusive: {result.time_window.before}</p>}
      {!result.time_window.since && !result.time_window.before && <p>No event-time bounds were applied to this query.</p>}
      <p className="text-surface-400">Recorded execution bounds, not a new time window or live check.</p>
    </div> : <p className="mb-3 text-xs text-surface-500">Applied event-time bounds were not recorded for this result.</p>}
    {result.query?.params && Object.keys(result.query.params).length > 0 && <details className="mb-3 rounded border border-surface-700 p-3 text-xs text-surface-400"><summary className="cursor-pointer">Recorded query parameters</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(result.query.params, null, 2)}</pre></details>}
    {rows.length > 0 ? <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-surface-700">{columns.map(column => <th key={column} scope="col" className="p-2 text-left text-surface-400">{column}</th>)}</tr></thead>
          <tbody>{visible.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-surface-800">{columns.map(column => <td key={column} className="min-w-32 max-w-xs whitespace-pre-wrap break-words p-2 align-top text-surface-300">{cellText(row[column])}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <p role="status" className="text-surface-400">Showing {(currentPage - 1) * 20 + 1}–{Math.min(currentPage * 20, rows.length)} of {rows.length} retained rows · Page {currentPage} of {pages}</p>
        <div className="flex gap-2">
          <button type="button" aria-label={`Previous rows for query ${index + 1}`} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Previous rows</button>
          <button type="button" aria-label={`Next rows for query ${index + 1}`} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Next rows</button>
        </div>
      </div>
    </> : <p className="text-xs text-surface-400">No retained evidence rows for this query.</p>}
    {typeof result.row_count === 'number' && result.row_count > rows.length && <p className="mt-3 text-xs text-warning">{result.row_count - rows.length} reported rows were not retained in this result. They are not available through paging.</p>}
    {result.error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs text-danger">{result.error}</p>}
  </section>;
}
