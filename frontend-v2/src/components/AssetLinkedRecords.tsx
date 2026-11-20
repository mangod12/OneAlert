import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
const kinds = { alerts: 'Alert records', sboms: 'SBOM documents', discovered_devices: 'Correlated discovery records', suppression_rules: 'Asset-specific suppression rules' };
type Kind = keyof typeof kinds;
interface Snapshot { asset_id: number; asset_name: string; kind: Kind; page: number; size: number; search: string; total: number; counts: Record<Kind, number>; unavailable_reference_count: number; retrieved_at: string; records: Record<string, unknown>[] }
const label = (field: string) => field.replaceAll('_', ' ');
const valueText = (value: unknown) => value === null || value === undefined || value === '' ? 'Not recorded' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
export function AssetLinkedRecords({ assetId }: { assetId: number }) {
  const [opened, setOpened] = useState(false), [kind, setKind] = useState<Kind>('alerts'), [page, setPage] = useState(1), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setSnapshot(null); setError('');
    if (!opened) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Snapshot>(`/assets/${assetId}/linked-records`, { params: { kind, page, size: 10, search } }).then(({ data }) => {
      if (request !== reads.current) return;
      if (data.asset_id !== assetId || data.kind !== kind || data.page !== page || data.size !== 10 || data.search !== search || !Array.isArray(data.records) || !Number.isSafeInteger(data.total) || data.total < 0 || data.records.some(row => !Number.isSafeInteger(row.id) || Number(row.id) <= 0)) throw new Error('Linked records did not match this asset and page. Retry the evidence read.');
      const lastPage = Math.max(1, Math.ceil(data.total / 10)); if (page > lastPage) { setPage(lastPage); return; }
      setSnapshot(data);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Linked records could not be loaded.')); })
      .finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [assetId, kind, page, search, retry, opened]);
  return <section aria-label="Asset linked records" className="space-y-3 rounded border border-surface-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Linked operational records</h3>
    <p className="text-xs text-surface-400">Read-only current references to this exact inventory record. Closed alerts and disabled rules are included. This does not scan, unlink or delete anything. Counts and pages are separate live reads, not a frozen snapshot.</p>
    {!opened ? <button type="button" onClick={() => setOpened(true)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Load linked operational records</button> : <>
      <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-surface-300">Record type<select aria-label="Linked record type" value={kind} onChange={event => { setKind(event.target.value as Kind); setPage(1); setSearch(''); setQuery(''); }} className="mt-1 block max-w-full rounded border border-surface-600 bg-surface-950 p-2 text-xs">{Object.entries(kinds).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query.trim()); setRetry(value => value + 1); }}><label className="min-w-0 text-xs text-surface-300">Search this record type<input aria-label="Search linked records" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} className="mt-1 block w-full min-w-0 rounded border border-surface-600 bg-surface-950 p-2 text-xs" /></label><button type="submit" className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Search linked records</button></form></div>
      {loading && <p role="status" className="text-xs text-surface-300">Loading linked records...</p>}{error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
      {!loading && !error && snapshot && <>
        <dl className="grid gap-2 text-xs text-surface-300 sm:grid-cols-2">{Object.entries(kinds).map(([key, title]) => <div key={key}><dt>{title}</dt><dd>{snapshot.counts[key as Kind]} owned references</dd></div>)}</dl>
        {snapshot.unavailable_reference_count > 0 && <p className="text-xs text-warning">{snapshot.unavailable_reference_count} additional references are unavailable to this account. Their contents are not included.</p>}
        <p className="break-words text-xs text-surface-400">{snapshot.total} matching {kinds[kind].toLowerCase()} · Page {page} of {Math.max(1, Math.ceil(snapshot.total / 10))} · Received {snapshot.retrieved_at}. Counts above are before search.</p>
        {snapshot.records.length === 0 && <p className="text-xs text-surface-300">No records match this asset and search.</p>}
        <ol className="space-y-2">{snapshot.records.map(row => <li key={Number(row.id)} className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h4 className="font-semibold text-surface-100">{kinds[kind]} #{String(row.id)}</h4><dl className="grid gap-2 sm:grid-cols-2">{Object.entries(row).filter(([key]) => key !== 'id').map(([field, value]) => <div key={field} className="min-w-0"><dt className="text-surface-400">{label(field)}</dt><dd className="whitespace-pre-wrap break-words">{valueText(value)}</dd></div>)}</dl>{kind === 'sboms' && <a className="inline-block text-primary-300" href={`/app/sbom?sbom=${row.id}`}>Open exact SBOM #{String(row.id)}</a>}{kind === 'suppression_rules' && <a className="inline-block text-primary-300" href={`/app/settings/suppression-rules/${row.id}`}>Review exact suppression rule #{String(row.id)}</a>}{kind === 'alerts' && <a className="inline-block text-primary-300" href={`/app/alerts?alert=${row.id}`}>Open exact alert #{String(row.id)}</a>}{kind === 'discovered_devices' && <a className="inline-block text-primary-300" href={`/app/ot?device=${row.id}`}>Open exact discovery record #{String(row.id)}</a>}</li>)}</ol>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Previous linked records</button><button type="button" disabled={page * 10 >= snapshot.total} onClick={() => setPage(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">More linked records</button></div>
      </>}
      <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Refresh linked records</button>
    </>}
  </section>;
}
