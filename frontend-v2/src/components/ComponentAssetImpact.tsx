import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
export interface ComponentScope { search: string; version: string; vulnerable_only: boolean }
interface AssetRow { asset_id: number; asset_name: string; matching_rows: number; document_count: number; recorded_version_count: number; missing_version_rows: number; rows_with_recorded_vulnerabilities: number; newest_matching_document_at: string | null }
interface Snapshot extends ComponentScope { page: number; size: number; total: number; retrieved_at: string; assets: AssetRow[] }
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function ComponentAssetImpact({ scope }: { scope: ComponentScope }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    const read = ++request.current; setSnapshot(null); setError(''); setLoading(true);
    void apiClient.get<Snapshot>('/sbom/component-search/assets', { params: { ...scope, page, size: 10 } }).then(({ data }) => {
      if (read !== request.current) return;
      if (data.search !== scope.search || data.version !== scope.version || data.vulnerable_only !== scope.vulnerable_only || data.page !== page || data.size !== 10 || !whole(data.total) || !Array.isArray(data.assets) || data.assets.length > 10 || new Set(data.assets.map(row => row.asset_id)).size !== data.assets.length || data.assets.some(row => !whole(row.asset_id) || row.asset_id === 0 || !whole(row.matching_rows) || !row.matching_rows || !whole(row.document_count) || !row.document_count || row.document_count > row.matching_rows || !whole(row.recorded_version_count) || row.recorded_version_count > row.matching_rows || !whole(row.missing_version_rows) || row.missing_version_rows > row.matching_rows || row.recorded_version_count + row.missing_version_rows > row.matching_rows || !whole(row.rows_with_recorded_vulnerabilities) || row.rows_with_recorded_vulnerabilities > row.matching_rows)) throw new Error('Asset groups did not match this saved-component search. Retry before relying on them.');
      const last = Math.max(1, Math.ceil(data.total / 10)); if (page > last) { setPage(last); return; } setSnapshot(data);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Matching assets could not be loaded.')); }).finally(() => { if (read === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [scope, page, retry]);
  return <section aria-label="Assets with matching saved components" className="space-y-4">
    <h2 className="text-base font-semibold text-surface-100">Assets with matching saved components</h2>
    <p className="text-sm text-surface-400">Grouped across all retained documents, including older uploads. Each asset appears once. Counts describe matching saved rows and documents, not current installations, distinct CVEs, exploitability or confirmed exposure. Ordered by rows with recorded vulnerabilities, matching row count, then asset ID.</p>
    <p className="break-words text-xs text-surface-400">Applied search: {scope.search} · Version: {scope.version || 'Any recorded or missing version'} · Recorded vulnerabilities: {scope.vulnerable_only ? 'Greater than zero' : 'Any count'}</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading grouped asset evidence...</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Retry matching assets</button></div>}
    {!loading && !error && snapshot && <>
      <p className="text-sm text-surface-300">{snapshot.total} assets with matching saved rows</p><p className="text-xs text-surface-400">Received {snapshot.retrieved_at}. Counts and rows are separate current reads. Asset names are current inventory values. The newest matching document timestamp does not establish current installation.</p>
      {!snapshot.assets.length && <p className="text-sm text-surface-400">No assets have matching saved component rows. This does not prove the software is absent.</p>}
      <ol className="space-y-3">{snapshot.assets.map(row => <li key={row.asset_id} className="oa-panel space-y-3 p-4 text-sm text-surface-200"><h3 className="break-words font-semibold">{row.asset_name} · Asset #{row.asset_id}</h3><dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries({ 'Matching saved component rows': row.matching_rows, 'Matching retained documents': row.document_count, 'Distinct nonempty recorded versions': row.recorded_version_count, 'Rows with missing version': row.missing_version_rows, 'Rows with recorded vulnerabilities': row.rows_with_recorded_vulnerabilities, 'Newest matching document timestamp': row.newest_matching_document_at || 'Not recorded' }).map(([field, value]) => <div key={field} className="min-w-0"><dt className="text-surface-400">{field}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value}</dd></div>)}</dl><a className="inline-block text-xs text-primary-300" href={`/app/assets?asset=${row.asset_id}`}>Open exact asset #{row.asset_id}</a></li>)}</ol>
      <div className="flex flex-wrap items-center gap-3 text-xs text-surface-300"><span>Asset page {page} of {Math.max(1, Math.ceil(snapshot.total / 10))}</span><button disabled={page <= 1} onClick={() => setPage(n => n - 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Previous matching assets</button><button disabled={page * 10 >= snapshot.total} onClick={() => setPage(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">More matching assets</button><button onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2">Refresh matching assets</button></div>
    </>}
  </section>;
}
