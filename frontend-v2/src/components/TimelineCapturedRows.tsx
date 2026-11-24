import { useState } from 'react';
import type { TimelineExportSnapshot } from '../utils/timelineReviewExport';

export function TimelineCapturedRows({ rows }: { rows: TimelineExportSnapshot['rows'] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / 10)), current = Math.min(page, pages - 1);
  return <details className="rounded-md border border-surface-700 p-2">
    <summary className="min-h-9 cursor-pointer py-2">Inspect captured matching rows ({rows.length})</summary>
    <p className="mb-2">These are the frozen raw values in this captured review, not refreshed records or unsaved edits. CSV escaping adds protection for spreadsheet formulas; this view shows the saved text without executing it. No links in saved text are opened automatically.</p>
    <p role="status">Captured rows {rows.length ? current * 10 + 1 : 0}-{Math.min((current + 1) * 10, rows.length)} of {rows.length}. Page {current + 1} of {pages}.</p>
    {pages > 1 && <div className="my-2 flex flex-wrap gap-2">
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="min-h-9 rounded-md border border-surface-600 px-2 disabled:opacity-50">Previous captured rows</button>
      <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} className="min-h-9 rounded-md border border-surface-600 px-2 disabled:opacity-50">Next captured rows</button>
    </div>}
    <ol className="mt-2 space-y-2" aria-label="Captured timeline rows" start={current * 10 + 1}>
      {rows.slice(current * 10, (current + 1) * 10).map((row, index) => <li key={`${index}:${row.id}`} className="min-w-0 rounded-md border border-surface-700 p-2 [overflow-wrap:anywhere]">
        <p className="font-medium text-surface-100">Captured entry #{row.id}</p>
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          <dt>Raw timestamp</dt><dd className="whitespace-pre-wrap">{row.timestamp || 'Not recorded'}</dd>
          <dt>Type</dt><dd className="whitespace-pre-wrap">{row.entry_type || 'Not recorded'}</dd>
          <dt>Source</dt><dd className="whitespace-pre-wrap">{row.source || 'Not recorded'}</dd>
          <dt>Recorded author</dt><dd className="whitespace-pre-wrap">{row.author_email || 'Not recorded'}</dd>
        </dl>
        <p className="mt-2 whitespace-pre-wrap">{row.content || '(Empty saved text)'}</p>
      </li>)}
    </ol>
  </details>;
}
