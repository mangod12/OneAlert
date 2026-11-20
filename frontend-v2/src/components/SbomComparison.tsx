import { useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { compareSnapshots, comparisonFields, type ComparisonField, type ComparisonKind, type SnapshotComponent } from '../utils/sbomComparison';

interface Snapshot { id: number; asset_id: number; created_at: string; format: string }
const fieldNames: Record<ComparisonField, string> = { version: 'Version', purl: 'Package URL', cpe: 'CPE', license: 'License', has_known_vulnerability: 'Recorded vulnerability count' };
const kinds: ComparisonKind[] = ['added', 'removed', 'changed', 'ambiguous', 'unchanged'];
const display = (value: string | number | null) => value === null ? 'Not recorded' : value === '' ? 'Empty value' : String(value);
const control = 'max-w-full rounded border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-200';

export function SbomComparison({ current, snapshots, onClose }: { current: Snapshot; snapshots: Snapshot[]; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView?.({ block: 'start' }); }, []);
  const choices = snapshots.filter(snapshot => snapshot.asset_id === current.asset_id && snapshot.id !== current.id);
  const [baselineId, setBaselineId] = useState('');
  const [result, setResult] = useState<{ baseline: SnapshotComponent[]; current: SnapshotComponent[] } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('differences');
  const [page, setPage] = useState(1);
  const baselineExists = choices.some(snapshot => String(snapshot.id) === baselineId);

  useEffect(() => {
    let cancelled = false;
    setResult(null); setError(''); setPage(1);
    if (!baselineId || !baselineExists) return;
    Promise.all([
      apiClient.get<SnapshotComponent[]>(`/sbom/${baselineId}/components`),
      apiClient.get<SnapshotComponent[]>(`/sbom/${current.id}/components`),
    ]).then(([before, after]) => {
      if (!cancelled) setResult({ baseline: before.data, current: after.data });
    }).catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'The two component inventories could not be compared.')); });
    return () => { cancelled = true; };
  }, [baselineId, baselineExists, current.id, retry]);

  const differences = useMemo(() => result ? compareSnapshots(result.baseline, result.current) : [], [result]);
  const term = search.trim().toLowerCase();
  const filtered = differences.filter(row => (kind === 'all' || (kind === 'differences' ? row.kind !== 'unchanged' : row.kind === kind)) && (!term || [row.name, row.supplier, ...row.baseline.flatMap(component => comparisonFields.map(field => component[field])), ...row.current.flatMap(component => comparisonFields.map(field => component[field]))].some(value => String(value ?? '').toLowerCase().includes(term))));
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 15, currentPage * 15);

  return <section ref={panel} tabIndex={-1} aria-label="SBOM snapshot comparison" className="oa-panel scroll-mt-20 min-w-0 focus:outline-none space-y-4 rounded-md p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-surface-100">Compare SBOM snapshots</h2><p className="text-sm text-surface-400">Current: SBOM #{current.id} · Asset #{current.asset_id} · {new Date(current.created_at).toLocaleString()}</p></div><button type="button" onClick={onClose} className={control}>Close comparison</button></div>
    <p className="text-xs text-surface-400">Read-only comparison of uploaded inventories, not proof of a deployment or remediation. Components match only by exact name and supplier. Duplicate identities are ambiguous and are never paired automatically. A renamed component or supplier change appears as added and removed. Hashes and dependency relationships are not compared.</p>
    <label className="block space-y-1 text-sm text-surface-300"><span>Baseline snapshot for this asset</span><select aria-label="Baseline SBOM snapshot" className={`${control} block w-full sm:w-auto`} value={baselineId} onChange={event => setBaselineId(event.target.value)}><option value="">Choose a baseline</option>{choices.map(snapshot => <option key={snapshot.id} value={snapshot.id}>SBOM #{snapshot.id} · {snapshot.format} · {new Date(snapshot.created_at).toLocaleString()}</option>)}</select></label>
    {!choices.length && <p className="text-sm text-surface-400">Upload another SBOM for this asset to compare snapshots.</p>}
    {baselineId && !baselineExists && <p role="alert" className="text-sm text-warning-300">This baseline is no longer in the inventory. Choose another snapshot.</p>}
    {baselineId && baselineExists && (error ? <div className="space-y-2"><p role="alert" className="text-sm text-danger-400">{error}</p><button type="button" className={control} onClick={() => setRetry(value => value + 1)}>Retry comparison</button></div> : !result ? <p role="status" className="text-sm text-surface-400">Loading both component inventories...</p> : <>
      <p className="text-sm text-surface-300">Baseline #{baselineId}: {result.baseline.length} component rows. Current #{current.id}: {result.current.length} component rows.</p>
      <div aria-label="Comparison totals" className="flex flex-wrap gap-2">{kinds.map(value => <span key={value} className="rounded border border-surface-600 px-2 py-1 text-xs text-surface-200">{value}: {differences.filter(row => row.kind === value).length}</span>)}</div>
      <p className="text-xs text-surface-400">Totals count name/supplier groups, not individual component rows. Recorded vulnerability counts are snapshot evidence, not a live vulnerability scan.</p>
      <div className="flex flex-wrap gap-2"><input aria-label="Search snapshot comparison" placeholder="Component, version, license or identifier" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className={`${control} min-w-0 basis-full sm:basis-0 sm:flex-1`} /><select aria-label="Comparison change type" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }} className={control}><option value="differences">Differences only</option><option value="all">All groups</option>{kinds.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
      <p className="text-xs text-surface-400">{filtered.length} of {differences.length} groups match. Page {currentPage} of {pages}.</p>
      {!visible.length && <p className="text-sm text-surface-400">No component groups match these filters.</p>}
      <div className="space-y-3">{visible.map(row => <article key={row.key} className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="break-words font-semibold text-surface-100 [overflow-wrap:anywhere]">{row.name}</h3><span className="text-xs text-primary-300">{row.kind}</span></div><p className="break-words text-xs text-surface-400 [overflow-wrap:anywhere]">Supplier: {display(row.supplier)}</p>
        {row.kind === 'ambiguous' ? <p className="text-sm text-warning-300">Cannot pair this identity safely. Baseline has {row.baseline.length} rows; current has {row.current.length} rows. Inspect the source component inventories.</p> : <div className="space-y-2">{(row.kind === 'changed' ? row.fields : comparisonFields).map(field => <div key={field} className="min-w-0 rounded bg-surface-950/50 p-2 text-xs"><p className="mb-1 text-surface-400">{fieldNames[field]}</p><div className="grid min-w-0 gap-2 sm:grid-cols-2"><p className="whitespace-pre-wrap break-words text-surface-300 [overflow-wrap:anywhere]">Baseline: {row.baseline[0] ? display(row.baseline[0][field]) : 'Component absent'}</p><p className="whitespace-pre-wrap break-words text-surface-200 [overflow-wrap:anywhere]">Current: {row.current[0] ? display(row.current[0][field]) : 'Component absent'}</p></div></div>)}</div>}
      </article>)}</div>
      <nav aria-label="Comparison pages" className="flex flex-wrap justify-between gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className={`${control} disabled:opacity-40`}>Previous comparison groups</button><button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className={`${control} disabled:opacity-40`}>More comparison groups</button></nav>
    </>)}
  </section>;
}
