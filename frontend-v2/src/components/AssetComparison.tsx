import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import type { Asset } from '../api/types';
import { getApiErrorMessage } from '../api/errors';
import { assetComparisonFields, assetValue, validComparisonAsset } from '../utils/assetComparison';
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function AssetComparison({ ids, revision = 0 }: { ids: number[]; revision?: number }) {
  const [snapshot, setSnapshot] = useState<{ assets: Asset[]; loadedAt: string } | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [query, setQuery] = useState(''), [changedOnly, setChangedOnly] = useState(true), [page, setPage] = useState(1);
  const request = useRef(0), left = ids[0], right = ids[1];
  useEffect(() => { request.current += 1; setSnapshot(null); setError(''); setLoading(false); setPage(1); return () => { request.current += 1; }; }, [left, right, revision]);
  const load = async () => {
    const id = ++request.current; setSnapshot(null); setError(''); setPage(1);
    if (!Number.isSafeInteger(left) || left < 1 || !Number.isSafeInteger(right) || right < 1 || left === right) { setError('Choose two different asset records before loading a comparison.'); return; }
    setLoading(true);
    try {
      const responses = await Promise.all([left, right].map(id => apiClient.get(`/assets/${id}`)));
      if (request.current !== id) return;
      const assets = responses.map(response => response.data as unknown);
      if (!assets.every((asset, index) => validComparisonAsset(asset, [left, right][index]))) throw new Error('Asset records did not match the requested selection or data format. Reload before comparing.');
      setSnapshot({ assets: assets as Asset[], loadedAt: new Date().toLocaleString() });
    } catch (err) { if (request.current === id) setError(getApiErrorMessage(err, 'Asset comparison unavailable. Missing records do not establish equality or lower risk.')); }
    finally { if (request.current === id) setLoading(false); }
  };
  const differences = snapshot ? assetComparisonFields.filter(([key]) => snapshot.assets[0][key] !== snapshot.assets[1][key]) : [];
  const needle = query.trim().toLocaleLowerCase();
  const rows = snapshot ? (changedOnly ? differences : assetComparisonFields).filter(([key, label]) => !needle || [label, assetValue(snapshot.assets[0][key]), assetValue(snapshot.assets[1][key])].some(value => value.toLocaleLowerCase().includes(needle))) : [];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  return <section aria-label="Compare inventory asset records" className="oa-panel space-y-3 p-4">
    <h2 className="text-sm font-semibold text-surface-100">Compare inventory asset records</h2>
    <p className="text-xs text-surface-400">Select a baseline and comparison asset across inventory pages or filters. Selection order defines sides, not chronology or replacement suitability. Loading reads both current inventory records separately. Network fields are recorded values, not live connectivity checks. Risk is computed from recorded inventory/alert data, not a new scan.</p>
    <p className="break-words text-xs text-surface-200">Asset selection: {ids.length ? ids.map(id => `#${id}`).join(' → ') : 'None'}</p>
    <button type="button" className={control} disabled={ids.length !== 2 || loading} onClick={() => void load()}>{loading ? 'Loading asset comparison...' : 'Load selected asset comparison'}</button>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {snapshot && <>
      <p className="text-xs text-surface-400">Baseline #{left}: {snapshot.assets[0].name} → Comparison #{right}: {snapshot.assets[1].name}. {differences.length} of {assetComparisonFields.length} shown inventory fields differ. Loaded {snapshot.loadedAt}. This is not an atomic snapshot, historical version comparison or a device compatibility check. Reload after edits elsewhere.</p>
      <div className="flex flex-wrap items-center gap-3"><label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-surface-400">Find compared fields<input aria-label="Search asset comparison" className={control} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={changedOnly} onChange={event => { setChangedOnly(event.target.checked); setPage(1); }} />Differing inventory fields only</label></div>
      {!rows.length && <p role="status" className="text-xs text-surface-300">{differences.length === 0 && changedOnly && !needle ? 'No differences in the shown recorded fields. This does not establish equivalent devices or equal operational risk.' : 'No compared fields match these display filters.'}</p>}
      <dl className="space-y-3">{rows.slice((currentPage - 1) * 8, currentPage * 8).map(([key, label]) => <div key={key} className="min-w-0 rounded border border-surface-700 p-3"><dt className="mb-2 text-xs font-semibold text-surface-100">{label} · {snapshot.assets[0][key] === snapshot.assets[1][key] ? 'Same recorded value' : 'Different recorded values'}</dt><dd className="grid min-w-0 gap-3 text-xs text-surface-300 sm:grid-cols-2">{snapshot.assets.map((asset, index) => <div key={asset.id} className="min-w-0"><p className="mb-1 text-surface-400">{index === 0 ? 'Baseline' : 'Comparison'} #{asset.id}</p><p className="whitespace-pre-wrap break-words">{assetValue(asset[key])}</p></div>)}</dd></div>)}</dl>
      <nav aria-label="Asset comparison field pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" className={control} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous compared fields</button><span>Page {currentPage} of {Math.max(1, Math.ceil(rows.length / 8))} · {rows.length} matching fields</span><button type="button" className={control} disabled={currentPage * 8 >= rows.length} onClick={() => setPage(currentPage + 1)}>More compared fields</button></nav>
      <div className="flex flex-wrap gap-3 text-xs">{snapshot.assets.map(asset => <Link key={asset.id} to={`/alerts?asset_id=${asset.id}`} className="text-primary-300">Review alerts for asset #{asset.id}</Link>)}</div>
    </>}
  </section>;
}
