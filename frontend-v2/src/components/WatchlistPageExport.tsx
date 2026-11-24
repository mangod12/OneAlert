import { useRef } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import { watchlistPageCsv, type WatchPageExport } from '../utils/watchlistPageExport';
const control = 'max-w-full rounded border border-surface-700 px-3 py-2 text-xs text-surface-200';
export function WatchlistPageExport({ snapshot, onClose }: { snapshot: WatchPageExport; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null); useDialogFocus(ref, onClose); const f = snapshot.filters;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><section ref={ref} role="dialog" aria-modal="true" aria-label="Review watchlist page export" className="max-h-[90dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h3 className="text-lg font-semibold">Review watchlist page export</h3>
    <p className="text-sm">Only page {snapshot.page}: {snapshot.records.length} loaded records of {snapshot.total} matching at that read. Page size 25. Other pages are not included. Loaded {snapshot.loadedAt}; captured locally {snapshot.capturedAt}; server UTC date basis {snapshot.dateBasis}.</p>
    <p className="text-xs text-warning">This freezes loaded records, not freshly fetched state, your full watchlist, watch history or complete audit evidence. Records and follows can change. Titles, IDs, CVEs, assets and search text may be sensitive. Review before sharing. Download sends no message, upload, subscription change or access grant.</p>
    <p className="text-xs">Applied filters: query {JSON.stringify(f.query)}; type {f.kind}; severity {f.severity}; work scope {f.scope}; order {f.sort}. Search drafts are not included. Overdue uses the recorded UTC date basis, not the download date. Completion is not remediation proof.</p>
    <ul aria-label="Watchlist page export record review" className="max-h-64 space-y-2 overflow-y-auto text-sm">{snapshot.records.map(row => <li key={`${row.kind}-${row.id}`} className="rounded border border-surface-700 p-2">{row.kind === 'alert' ? 'Alert' : 'Investigation'} #{row.id}: {row.title}<p className="text-xs">{row.severity ?? 'Severity not recorded'} · {row.status ?? 'Status not recorded'} · CVE {row.cve_id || 'not recorded'} · Asset {row.asset_name || 'not recorded'} · Created {row.created_at || 'not recorded'} · Due {row.due_date || 'not recorded'}</p></li>)}</ul>
    <button type="button" className={control} onClick={() => { const url = URL.createObjectURL(new Blob([watchlistPageCsv(snapshot)], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `watchlist-page-${snapshot.page}.csv`; link.click(); URL.revokeObjectURL(url); }}>Download reviewed watchlist page CSV ({snapshot.records.length} records)</button>
    <button type="button" className={control} onClick={onClose}>Cancel watchlist page export</button>
  </section></div>;
}
