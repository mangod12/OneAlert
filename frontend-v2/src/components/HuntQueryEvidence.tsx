import { useState } from 'react';
import { FileCode } from 'lucide-react';

type HuntRow = Record<string, unknown>;
export interface HuntQueryResult {
  query?: { description?: string; sql?: string };
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
