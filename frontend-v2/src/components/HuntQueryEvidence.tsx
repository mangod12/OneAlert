import { RetainedHuntCurrentEvent } from './RetainedHuntCurrentEvent';
import { useState } from 'react';
import { huntQueryCsv, huntQueryJson, saveHuntDownload } from '../utils/huntEvidence';
import { FileCode } from 'lucide-react';

type HuntRow = Record<string, unknown>;
export interface HuntQueryResult {
  outcome?: 'completed' | 'rejected' | 'failed';
  query?: { description?: string; sql?: string; params?: Record<string, unknown>; reviewed_query_number?: number };
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

export function HuntQueryEvidence({ result, index, savedReview, originalDraftQuery }: { result: HuntQueryResult; index: number; originalDraftQuery?: number; savedReview?: { sessionId: number; fingerprint: string; onRefresh: () => void } }) {
  const [selected, setSelected] = useState<{ rowNumber: number; eventId: number } | null>(null);
  const canReview = savedReview && Number.isSafeInteger(savedReview.sessionId) && savedReview.sessionId > 0 && /^[0-9a-f]{64}$/.test(savedReview.fingerprint) && result.outcome === 'completed' && result.execution?.contract === 'scoped_select_v1' && result.execution.selected_columns.includes('id') && new Set(result.execution.selected_columns).size === result.execution.selected_columns.length;
  const [inspectionOrder, setInspectionOrder] = useState('retained');
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [field, setField] = useState('');
  const rows = result.rows ?? [];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const displayedColumns = columns.filter(column => !hiddenColumns.includes(column));
  const needle = search.trim().toLowerCase();
  const matches = needle ? rows.filter(row => (field ? [row[field]] : Object.values(row)).some(value => value != null && (typeof value === 'object' ? JSON.stringify(value) : String(value)).toLowerCase().includes(needle))) : rows;
  const ordered = inspectionOrder === 'retained' ? matches : [...matches].sort((a, b) => {
    const aValid = Number.isSafeInteger(a.id) && Number(a.id) > 0, bValid = Number.isSafeInteger(b.id) && Number(b.id) > 0;
    if (!aValid) return bValid ? 1 : 0;
    if (!bValid) return -1;
    return inspectionOrder === 'id-desc' ? Number(b.id) - Number(a.id) : Number(a.id) - Number(b.id);
  });
  const pages = Math.max(1, Math.ceil(matches.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = ordered.slice((currentPage - 1) * 20, currentPage * 20);
  return <section aria-label={`Query ${index + 1} evidence`} className="mb-4 min-w-0 rounded-lg border border-surface-700 p-3 last:mb-0">
    {Number.isInteger(originalDraftQuery) && Number(originalDraftQuery) >= 1 && Number(originalDraftQuery) <= 3 && <p className="mb-3 text-xs text-surface-400">Original saved draft query #{originalDraftQuery}, shown as result position {index + 1} in this selected-query execution.</p>}
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <FileCode className="h-4 w-4 shrink-0 text-primary-400" aria-hidden="true" />
      <h3 className="min-w-0 break-words text-sm font-medium text-surface-50">{result.query?.description || `Query ${index + 1}`}</h3>
    </div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className={result.outcome === 'completed' ? 'text-success' : result.outcome ? 'text-warning' : 'text-surface-500'}>{result.outcome === 'completed' ? 'Query completed' : result.outcome === 'rejected' ? 'Rejected before execution' : result.outcome === 'failed' ? 'Execution failed' : 'Query outcome not recorded'}</p>
      <button type="button" disabled={!rows.length} aria-label={`Export retained rows for query ${index + 1}`} onClick={() => saveHuntDownload(huntQueryCsv(result, index), `hunt-query-${index + 1}-retained-rows.csv`, 'text/csv;charset=utf-8')} className="rounded border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Export retained rows CSV</button>
    </div>
    <button type="button" onClick={() => saveHuntDownload(huntQueryJson(result, index, new Date().toISOString()), `hunt-query-${index + 1}-retained-evidence.json`, 'application/json;charset=utf-8')} className="mb-2 rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Export retained query JSON</button>
    <p className="mb-2 text-xs text-surface-400">JSON includes this query's recorded SQL, parameters, execution bounds, outcome and all retained rows across pages, regardless of local search. Missing evidence stays missing. Raw text has no spreadsheet formula protection. Review sensitive telemetry before sharing; downloading sends nothing to another person.</p>
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
    {rows.length > 0 && <section aria-label={`Search query ${index + 1} retained rows`} className="mb-3 space-y-2 rounded border border-surface-700 p-3">
      <label className="block text-xs text-surface-300">Search retained row values<input type="search" aria-label={`Search retained rows for query ${index + 1}`} maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="mt-1 min-h-9 w-full min-w-0 rounded border border-surface-600 bg-surface-950 px-2 text-sm text-surface-100" /></label>
      <div className="flex flex-wrap gap-2"><select aria-label={`Search field for query ${index + 1}`} value={field} onChange={event => { setField(event.target.value); setPage(1); }} className="max-w-full rounded border border-surface-600 bg-surface-950 px-2 py-2 text-xs text-surface-200"><option value="">All retained fields</option>{columns.map(column => <option key={column} value={column}>{column}</option>)}</select>
        {(search || field) && <button type="button" onClick={() => { setSearch(''); setField(''); setPage(1); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Clear retained row search</button>}
        {needle && <button type="button" disabled={!matches.length} onClick={() => saveHuntDownload(huntQueryCsv({ ...result, rows: matches }, index, { text: search.trim(), field: field || null, retained_total: rows.length }), `hunt-query-${index + 1}-matching-retained-rows.csv`, 'text/csv;charset=utf-8')} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Export matching retained rows CSV</button>}
        {needle && <button type="button" disabled={!matches.length} onClick={() => saveHuntDownload(huntQueryJson({ ...result, rows: matches }, index, new Date().toISOString(), { text: search.trim(), field: field || null, retained_total: rows.length }), `hunt-query-${index + 1}-matching-retained-evidence.json`, 'application/json;charset=utf-8')} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Export matching retained query JSON</button>}
      </div>
      <p className="text-xs text-surface-400">Matching JSON includes all locally matching retained rows across pages, the literal search and selected field, the retained total before search and unchanged recorded query context. Reported counts still describe the original query, not the local match count. No query is rerun; the full retained JSON export stays unfiltered.</p>
      <p className="text-xs text-surface-400">Searches literal text in retained values only, including nested JSON values, across their local pages. No query is rerun. Missing values do not match. Unretained reported rows are not searched. The original retained-row export above remains unfiltered.</p>
      <label className="block text-xs text-surface-300">Retained row inspection order<select aria-label={`Retained row inspection order for query ${index + 1}`} value={inspectionOrder} onChange={event => { setInspectionOrder(event.target.value); setPage(1); }} className="mt-1 block max-w-full rounded border border-surface-600 bg-surface-950 px-2 py-2 text-xs text-surface-200"><option value="retained">Original retained order</option><option value="id-asc">Recorded numeric ID, ascending</option><option value="id-desc">Recorded numeric ID, descending</option></select></label>
      <p className="text-xs text-surface-400">Inspection order affects this table only, never query execution, recorded order or CSV/JSON download order. Equal IDs keep retained order; missing or invalid IDs stay last in retained order. ID order is not event chronology or severity.</p>
      <details className="rounded border border-surface-600 p-2 text-xs text-surface-300"><summary className="cursor-pointer">Inspection columns: {displayedColumns.length} of {columns.length}</summary>
        <p className="my-2 text-surface-400">Choose table columns only. Search still uses its selected field or all retained fields, including hidden columns. Downloads keep every retained field. Current-event comparison uses the original saved selection.</p>
        <fieldset aria-label={`Inspection columns for query ${index + 1}`} className="flex flex-wrap gap-3">{columns.map(column => <label key={column} className="flex min-h-9 max-w-full items-center gap-2 break-all"><input type="checkbox" checked={!hiddenColumns.includes(column)} disabled={!hiddenColumns.includes(column) && displayedColumns.length === 1} onChange={event => setHiddenColumns(previous => event.target.checked ? previous.filter(value => value !== column) : [...previous, column])} />{column}</label>)}</fieldset>
        {hiddenColumns.length > 0 && <button type="button" onClick={() => setHiddenColumns([])} className="mt-2 min-h-9 rounded border border-surface-600 px-3 py-2 text-surface-200">Show all retained fields</button>}
      </details>
      <p role="status" className="text-xs text-surface-300">{matches.length} of {rows.length} retained rows match{field ? ` in ${field}` : ''}.</p>
    </section>}
    {matches.length > 0 ? <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-surface-700">{displayedColumns.map(column => <th key={column} scope="col" className="p-2 text-left text-surface-400">{column}</th>)}{canReview && <th scope="col" className="p-2 text-left text-surface-400">Current selected-field evidence</th>}</tr></thead>
          <tbody>{visible.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-surface-800">{displayedColumns.map(column => <td key={column} className="min-w-32 max-w-xs whitespace-pre-wrap break-words p-2 align-top text-surface-300">{cellText(row[column])}</td>)}{canReview && <td className="p-2 align-top">{Number.isSafeInteger(row.id) && Number(row.id) > 0 && Number(row.id) <= 2147483647 ? <button type="button" className="min-h-10 rounded border border-surface-600 px-3 py-2 text-left text-primary-300" onClick={() => setSelected({ rowNumber: rows.indexOf(row) + 1, eventId: Number(row.id) })}>Compare current event for retained row {rows.indexOf(row) + 1}</button> : <span className="text-surface-400">No supported retained event ID</span>}</td>}</tr>)}</tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <p role="status" className="text-surface-400">Showing {(currentPage - 1) * 20 + 1}–{Math.min(currentPage * 20, matches.length)} of {matches.length} retained rows · Page {currentPage} of {pages}</p>
        <div className="flex gap-2">
          <button type="button" aria-label={`Previous rows for query ${index + 1}`} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Previous rows</button>
          <button type="button" aria-label={`Next rows for query ${index + 1}`} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Next rows</button>
        </div>
      </div>
    </> : <p className="text-xs text-surface-400">{rows.length ? 'No retained rows match this local search. Clear it to review the retained evidence.' : 'No retained evidence rows for this query.'}</p>}
    {typeof result.row_count === 'number' && result.row_count > rows.length && <p className="mt-3 text-xs text-warning">{result.row_count - rows.length} reported rows were not retained in this result. They are not available through paging.</p>}
    {savedReview && !canReview && <p className="mb-3 text-xs text-surface-400">Current event comparison needs a saved completed scoped-select result with the event ID selected and a supported loaded-evidence fingerprint. No ID or execution context is inferred for older results.</p>}
    {canReview && savedReview && selected && result.execution && <RetainedHuntCurrentEvent key={`${savedReview.fingerprint}:${selected.rowNumber}:${selected.eventId}`} sessionId={savedReview.sessionId} queryNumber={index + 1} rowNumber={selected.rowNumber} eventId={selected.eventId} fingerprint={savedReview.fingerprint} columns={result.execution.selected_columns} onClose={() => setSelected(null)} onRefreshSaved={() => { setSelected(null); savedReview.onRefresh(); }} />}
    {result.error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs text-danger">{result.error}</p>}
  </section>;
}
