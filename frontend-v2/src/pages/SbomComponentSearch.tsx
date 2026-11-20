import { ComponentAssetImpact } from '../components/ComponentAssetImpact';
import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
interface RecordRow { component: { id: number; sbom_id: number; name: string; version: string | null; supplier: string | null; purl: string | null; cpe: string | null; license: string | null; has_known_vulnerability: number }; sbom_id: number; asset_id: number; asset_name: string; document_created_at: string; document_source: string; document_format: string }
interface Snapshot { search: string; version: string; vulnerable_only: boolean; page: number; size: number; total: number; document_count: number; asset_count: number; retrieved_at: string; records: RecordRow[] }
const value = (text: unknown) => text === null || text === undefined || text === '' ? 'Not recorded' : String(text);
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function SbomComponentSearch() {
  const [query, setQuery] = useState(''), [version, setVersion] = useState(''), [vulnerable, setVulnerable] = useState(false);
  const [applied, setApplied] = useState<{ search: string; version: string; vulnerable_only: boolean } | null>(null), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'records' | 'assets'>('records');
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current; setSnapshot(null); setError('');
    if (!applied || mode === 'assets') { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Snapshot>('/sbom/component-search', { params: { ...applied, page, size: 10 } }).then(({ data }) => {
      if (id !== request.current) return;
      if (data.search !== applied.search || data.version !== applied.version || data.vulnerable_only !== applied.vulnerable_only || data.page !== page || data.size !== 10 || !count(data.total) || !count(data.document_count) || !count(data.asset_count) || !Array.isArray(data.records) || data.records.some(row => !positive(row.sbom_id) || !positive(row.asset_id) || !positive(row.component?.id) || row.component.sbom_id !== row.sbom_id)) throw new Error('The component results did not match this search. Retry before relying on them.');
      const last = Math.max(1, Math.ceil(data.total / 10)); if (page > last) { setPage(last); return; } setSnapshot(data);
    }).catch(err => { if (id === request.current) setError(getApiErrorMessage(err, 'Recorded components could not be searched.')); }).finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [applied, page, retry, mode]);
  const draft = !!applied && (query.trim() !== applied.search || version.trim() !== applied.version || vulnerable !== applied.vulnerable_only);
  return <div className="space-y-5">
    <PageHeader eyebrow="Observe" title="Find recorded components" description="Search saved software evidence across your retained SBOM documents and managed assets." />
    <a href="/app/sbom" className="inline-block text-sm text-primary-300">Back to SBOM documents</a>
    <p className="text-sm text-surface-400">All retained documents are searched, including older uploads. Repeated components and multiple versions can describe the same asset at different times. A match is saved evidence, not proof of current installation, exploitability or a new vulnerability scan. No documents are treated as the latest authoritative inventory.</p>
    <form className="oa-panel flex flex-wrap items-end gap-3 p-4" onSubmit={event => { event.preventDefault(); if (!query.trim()) return; setApplied({ search: query.trim(), version: version.trim(), vulnerable_only: vulnerable }); setPage(1); setRetry(n => n + 1); }}>
      <label className="min-w-0 text-xs text-surface-300">Name, supplier, PURL or CPE<input required aria-label="Cross-asset component search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} className="mt-1 block w-full rounded border border-surface-600 bg-surface-950 p-2" /></label>
      <label className="min-w-0 text-xs text-surface-300">Exact recorded version (optional)<input aria-label="Exact recorded component version" maxLength={200} value={version} onChange={event => setVersion(event.target.value)} className="mt-1 block w-full rounded border border-surface-600 bg-surface-950 p-2" /></label>
      <label className="flex items-start gap-2 text-xs text-surface-300"><input type="checkbox" checked={vulnerable} onChange={event => setVulnerable(event.target.checked)} />Recorded vulnerability count greater than zero</label>
      <button type="submit" disabled={!query.trim()} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Search retained documents</button>
    </form>
    {applied && <div role="group" aria-label="Component results display" className="flex flex-wrap gap-3 text-xs"><button type="button" aria-pressed={mode === 'records'} onClick={() => { setMode('records'); setPage(1); }} className="rounded border border-surface-600 px-3 py-2 text-primary-300 aria-pressed:border-primary-400 aria-pressed:bg-primary-500/10 aria-pressed:text-primary-200">Show component rows</button><button type="button" aria-pressed={mode === 'assets'} onClick={() => { setMode('assets'); setPage(1); }} className="rounded border border-surface-600 px-3 py-2 text-primary-300 aria-pressed:border-primary-400 aria-pressed:bg-primary-500/10 aria-pressed:text-primary-200">Group matching records by asset</button></div>}
    {draft && <p role="status" className="text-sm text-warning">Draft search not applied. Results still use the last submitted search.</p>}
    {!applied && <p className="text-sm text-surface-400">Enter a component name, supplier or identifier to search all your retained documents, beyond the SBOM list page.</p>}
    {mode === 'assets' && applied && <ComponentAssetImpact key={JSON.stringify(applied) + retry} scope={applied} />}
    {mode === 'records' && loading && <p role="status" className="text-sm text-surface-300">Searching saved component evidence...</p>}
    {mode === 'records' && error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Retry component search</button></div>}
    {mode === 'records' && !loading && !error && snapshot && <>
      <section className="oa-panel space-y-2 p-4 text-sm text-surface-300 [overflow-wrap:anywhere]"><p>{snapshot.total} matching component rows · {snapshot.document_count} documents · {snapshot.asset_count} assets</p><p>Applied search: {snapshot.search} · Version: {snapshot.version || 'Any recorded or missing version'} · Recorded vulnerabilities: {snapshot.vulnerable_only ? 'Greater than zero' : 'Any count'}</p><p className="text-xs text-surface-400">Received {snapshot.retrieved_at}. Counts and rows are separate current reads, not a frozen historical snapshot. Asset names reflect current inventory.</p></section>
      {!snapshot.records.length && <p className="text-sm text-surface-400">No saved component rows match. This does not prove the software is absent from your environment.</p>}
      <ol className="space-y-3">{snapshot.records.map(row => <li key={row.component.id} className="oa-panel space-y-3 p-4 text-sm text-surface-200"><h2 className="break-words font-semibold">{row.component.name} · {value(row.component.version)}</h2><p className="break-words [overflow-wrap:anywhere]">Asset #{row.asset_id}: {row.asset_name} · SBOM #{row.sbom_id} · Component #{row.component.id}</p><p className="text-xs text-surface-400">{row.document_format} · {row.document_source} · Document created {row.document_created_at}</p><dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries({ Supplier: row.component.supplier, PURL: row.component.purl, CPE: row.component.cpe, License: row.component.license, 'Recorded vulnerability count': row.component.has_known_vulnerability }).map(([field, text]) => <div className="min-w-0" key={field}><dt className="text-surface-400">{field}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value(text)}</dd></div>)}</dl><div className="flex flex-wrap gap-4 text-xs text-primary-300"><a href={`/app/assets?asset=${row.asset_id}`}>Open exact asset #{row.asset_id}</a><a href={`/app/sbom?sbom=${row.sbom_id}`}>Open exact SBOM #{row.sbom_id}</a></div></li>)}</ol>
      <div className="flex flex-wrap items-center gap-3 text-xs text-surface-300"><span>Page {page} of {Math.max(1, Math.ceil(snapshot.total / 10))}</span><button type="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Previous component matches</button><button type="button" disabled={page * 10 >= snapshot.total} onClick={() => setPage(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">More component matches</button><button type="button" onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2">Refresh component matches</button></div>
    </>}
  </div>;
}
