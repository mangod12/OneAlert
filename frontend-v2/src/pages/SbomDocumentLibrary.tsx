import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
interface DocumentRow { id: number; asset_id: number; asset_name: string | null; format: string; version: string | null; source: string; component_count: number; vulnerability_count: number; created_at: string }
interface Library { documents: DocumentRow[]; total: number; page: number; size: number; query: string; asset_id: number | null; document_format: string; source: string; vulnerabilities_only: boolean; sort: string; formats: string[]; sources: string[]; retrieved_at: string }
export function SbomDocumentLibrary() {
  const [draft, setDraft] = useState(''), [query, setQuery] = useState('');
  const [assetDraft, setAssetDraft] = useState(''), [asset, setAsset] = useState('');
  const [format, setFormat] = useState(''), [source, setSource] = useState(''), [vulnerable, setVulnerable] = useState(false), [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<Library | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [formats, setFormats] = useState<string[]>([]), [sources, setSources] = useState<string[]>([]);
  const reads = useRef(0);
  const invalidAsset = assetDraft.trim() !== '' && (!/^[1-9][0-9]*$/.test(assetDraft.trim()) || !Number.isSafeInteger(Number(assetDraft.trim())));
  useEffect(() => {
    const request = ++reads.current; setLoading(true); setError(''); setData(null);
    void apiClient.get<Library>('/sbom/document-library', { params: { page, size: 10, query, asset_id: asset ? Number(asset) : undefined, document_format: format, source, vulnerabilities_only: vulnerable, sort } }).then(({ data: result }) => {
      if (request !== reads.current) return;
      if (!result || result.page !== page || result.size !== 10 || result.query !== query || result.asset_id !== (asset ? Number(asset) : null) || result.document_format !== format || result.source !== source || result.vulnerabilities_only !== vulnerable || result.sort !== sort || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.documents) || result.documents.length > 10 || !Array.isArray(result.formats) || !Array.isArray(result.sources) || result.documents.some(row => !Number.isSafeInteger(row.id) || row.id <= 0 || !Number.isSafeInteger(row.asset_id) || row.asset_id <= 0 || (asset && row.asset_id !== Number(asset)) || (format && row.format !== format) || (source && row.source !== source) || (vulnerable && !(row.vulnerability_count > 0))) || new Set(result.documents.map(row => row.id)).size !== result.documents.length) throw new Error('Document results did not match the requested filters and page. Refresh the library.');
      const last = Math.max(1, Math.ceil(result.total / 10)); if (page > last) { setPage(last); return; }
      setData(result); setFormats(result.formats); setSources(result.sources);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Document library could not be loaded.')); })
      .finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [page, query, asset, format, source, vulnerable, sort, retry]);
  const input = 'mt-1 block w-full max-w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm text-surface-100';
  const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
  return <div className="space-y-5">
    <PageHeader eyebrow="Observe" title="SBOM document library" description="Find current owned SBOM documents across all assets and pages, then open exact document evidence." />
    <Link to="/sbom" className="inline-block text-sm text-primary-300">Back to SBOM inventory and upload</Link>
    <form aria-label="Search SBOM document library" className="oa-panel flex flex-wrap items-end gap-3 p-4" onSubmit={event => { event.preventDefault(); if (invalidAsset) return; setPage(1); setQuery(draft.trim()); setAsset(assetDraft.trim()); setRetry(value => value + 1); }}>
      <label className="min-w-[14rem] flex-1 text-xs text-surface-300">Document metadata search<input aria-label="Search SBOM documents" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} className={input} /></label>
      <label className="min-w-0 text-xs text-surface-300">Exact asset ID<input aria-label="Document library asset ID" inputMode="numeric" value={assetDraft} onChange={event => setAssetDraft(event.target.value)} className={input} /></label>
      <button type="submit" disabled={invalidAsset} className={button}>Search document library</button>
      <label className="text-xs text-surface-300">Format<select aria-label="Document library format" value={format} onChange={event => { setFormat(event.target.value); setPage(1); }} className={input}><option value="">All formats</option>{formats.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs text-surface-300">Source<select aria-label="Document library source" value={source} onChange={event => { setSource(event.target.value); setPage(1); }} className={input}><option value="">All sources</option>{sources.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs text-surface-300">Order<select aria-label="Document library order" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }} className={input}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      <label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={vulnerable} onChange={event => { setVulnerable(event.target.checked); setPage(1); }} />Recorded vulnerability count above zero</label>
      <button type="button" className={button} onClick={() => { setDraft(''); setQuery(''); setAssetDraft(''); setAsset(''); setFormat(''); setSource(''); setSort('newest'); setVulnerable(false); setPage(1); }}>Clear document library filters</button>
    </form>
    {invalidAsset && <p role="alert" className="text-sm text-danger">Use one positive whole-number asset ID. The draft has not been applied.</p>}
    {(draft.trim() !== query || assetDraft.trim() !== asset) && <p className="text-xs text-warning">Document search draft not applied. Current keyword: {query || 'any'}. Current exact asset: {asset ? `#${asset}` : 'any'}.</p>}
    <p className="text-xs text-surface-400">Literal case-insensitive search covers document/asset IDs, version, source, format and owned asset names, not component contents. Format/source choices include all owned documents before filtering. Recorded component and vulnerability counts are saved metadata, not a fresh scan or a count of distinct CVEs. Missing asset names are not inferred. Counts and pages are separate current reads, not a frozen snapshot.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading document library...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="button" disabled={loading} className={button} onClick={() => setRetry(value => value + 1)}>Refresh document library</button>
    {!loading && !error && data && data.page === page && <>
      <p className="break-words text-xs text-surface-400">{data.total} matching documents · Page {page} of {Math.max(1, Math.ceil(data.total / 10))} · Received {data.retrieved_at}</p>
      {data.documents.length === 0 && <p className="text-sm text-surface-300">No documents match the applied filters.</p>}
      <ol className="grid gap-3 lg:grid-cols-2">{data.documents.map(row => <li key={row.id} className="oa-panel min-w-0 space-y-3 p-4 text-sm text-surface-300">
        <Link to={`/sbom?sbom=${row.id}`} className="break-words font-semibold text-primary-300">Open exact SBOM #{row.id}</Link>
        <p className="break-words">{row.asset_name ?? 'Asset name unavailable'} · Asset #{row.asset_id}</p>
        <dl className="grid grid-cols-2 gap-3 text-xs">{[['Format', row.format], ['Version', row.version || 'Not recorded'], ['Source', row.source], ['Created', row.created_at], ['Recorded components', row.component_count], ['Recorded vulnerability references', row.vulnerability_count]].map(([key, value]) => <div className="min-w-0" key={key}><dt className="text-surface-400">{key}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
        <Link to={`/assets?asset=${row.asset_id}`} className="inline-block text-xs text-primary-300">Open exact asset #{row.asset_id}</Link>
      </li>)}</ol>
      <nav aria-label="Document library pages" className="flex flex-wrap gap-3"><button type="button" disabled={page <= 1} className={button} onClick={() => setPage(value => value - 1)}>Previous documents</button><button type="button" disabled={page * 10 >= data.total} className={button} onClick={() => setPage(value => value + 1)}>More documents</button></nav>
    </>}
  </div>;
}
