import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';

const GROUPS = { alerts: 'Alerts', cases: 'Investigations', assets: 'Assets', events: 'Saved events', incidents: 'Incidents' };
type Kind = keyof typeof GROUPS;
interface SearchRecord {
  id?: number; asset_id?: number; title?: string; name?: string; asset_name?: string;
  severity?: string | null; status?: string; vendor?: string | null; asset_type?: string;
  signature?: string | null; event_type?: string; timestamp?: string; source_ip?: string | null; dest_ip?: string | null;
  alert_count?: number; max_severity?: string;
}
interface Result { query: string; kind: Kind; page: number; size: number; total: number; totals: Record<Kind, number>; retrieved_at: string; records: SearchRecord[]; }
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isId = (value: unknown) => isCount(value) && value > 0;
const text = (value: unknown) => typeof value === 'string';
const optionalText = (value: unknown) => value === null || text(value);
function validRecord(row: SearchRecord, kind: Kind) {
  if (!row) return false;
  if (kind === 'incidents') return isId(row.asset_id) && text(row.asset_name) && isCount(row.alert_count) && row.alert_count >= 2 && text(row.max_severity);
  if (!isId(row.id)) return false;
  if (kind === 'assets') return text(row.name) && optionalText(row.vendor) && text(row.asset_type);
  if (kind === 'events') return optionalText(row.signature) && text(row.event_type) && optionalText(row.severity) && text(row.timestamp) && Number.isFinite(Date.parse(row.timestamp!)) && optionalText(row.source_ip) && optionalText(row.dest_ip);
  return text(row.title) && text(row.status) && text(row.severity);
}
function locator(row: SearchRecord, kind: Kind) {
  if (kind === 'incidents') return `/incidents?asset_id=${row.asset_id}`;
  if (kind === 'assets') return `/assets?asset=${row.id}`;
  if (kind === 'alerts') return `/alerts?alert=${row.id}`;
  return `/${kind}/${row.id}`;
}
export function SearchWorkspace() {
  const [params, setParams] = useSearchParams();
  const queries = params.getAll('q'), kinds = params.getAll('kind'), pages = params.getAll('page');
  const query = queries.length === 1 ? queries[0].trim() : '';
  const kind = (kinds[0] || 'alerts') as Kind, pageValue = pages[0] || '1';
  const page = /^[1-9][0-9]*$/.test(pageValue) && Number.isSafeInteger(Number(pageValue)) ? Number(pageValue) : 0;
  const invalid = queries.length > 1 || kinds.length > 1 || pages.length > 1 || query.length > 200 || !Object.hasOwn(GROUPS, kind) || page < 1;
  const apply = (q: string, group: Kind = Object.hasOwn(GROUPS, kind) ? kind : 'alerts', nextPage = 1) => setParams({ q: q.trim(), kind: group, ...(nextPage > 1 ? { page: String(nextPage) } : {}) });
  return <SearchResults key={JSON.stringify([query, kind, page, invalid])} query={query} kind={kind} page={page} invalid={invalid} apply={apply} />;
}
function SearchResults({ query, kind, page, invalid, apply }: { query: string; kind: Kind; page: number; invalid: boolean; apply: (q: string, kind?: Kind, page?: number) => void }) {
  const [draft, setDraft] = useState(query), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const requestId = useRef(0), dirty = draft.trim() !== query;
  const eligible = !invalid && query.length >= 2;
  useEffect(() => {
    const id = ++requestId.current;
    if (!eligible) return;
    setLoading(true); setResult(null); setError('');
    void apiClient.get<Result>('/search/records', { params: { q: query, kind, page, size: 20 } }).then(({ data }) => {
      if (requestId.current !== id) return;
      if (!data || data.query !== query || data.kind !== kind || data.page !== page || data.size !== 20 || !isCount(data.total)
        || !data.totals || Object.keys(GROUPS).some(group => !isCount(data.totals[group as Kind])) || data.totals[kind] !== data.total
        || typeof data.retrieved_at !== 'string' || !Number.isFinite(Date.parse(data.retrieved_at))
        || !Array.isArray(data.records) || data.records.length > 20 || data.records.length > data.total
        || data.records.some(row => !validRecord(row, kind)) || new Set(data.records.map(row => kind === 'incidents' ? row.asset_id : row.id)).size !== data.records.length) throw new Error('Search results did not match the requested query and page. Retry before relying on them.');
      setResult(data);
    }).catch(err => { if (requestId.current === id) setError(getApiErrorMessage(err, 'Full workspace search is unavailable.')); })
      .finally(() => { if (requestId.current === id) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [eligible, query, kind, page, retry]);
  return <div className="space-y-5"><PageHeader eyebrow="Workspace" title="Search all matching records" description="Go beyond command-palette previews with full counts, record-type pages and exact destinations." />
    <section className="oa-panel space-y-4 p-4 sm:p-6">
      <form onSubmit={event => { event.preventDefault(); if (draft.trim().length >= 2) apply(draft); }} className="flex flex-wrap gap-2">
        <label className="flex min-w-0 basis-full flex-1 flex-col gap-2 text-sm text-surface-300 sm:basis-64">Search owned records<input type="search" aria-label="Full workspace query" value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} className="min-h-10 min-w-0 rounded border border-surface-600 bg-surface-950 px-3 text-surface-100" /></label>
        <button type="submit" disabled={draft.trim().length < 2} className="self-end rounded border border-surface-600 px-3 py-2 text-sm text-primary-300 disabled:opacity-40">Search all records</button>
        {dirty && <button type="button" onClick={() => setDraft(query)} className="self-end rounded border border-surface-600 px-3 py-2 text-xs text-surface-300">Discard query draft</button>}
      </form>
      <p className="text-xs text-surface-400">Literal, case-insensitive matching of your own saved records, not shared assignments or a live scan. Alerts match title, description and CVE; investigations match title and summary; assets and incidents match asset name, vendor and product. Saved events match normalized signature, signature ID, hostname, IP, category, type or an exact numeric event ID. Raw payload text is never searched or returned. The applied query is stored in this page URL. Review it before sharing.</p>
      {invalid ? <p role="alert" className="text-sm text-danger">Invalid search link. Use one query, a known record type and one positive whole-number page. Submit a search to reset the link. No record search was made.</p> : query.length < 2 ? <p className="text-sm text-surface-400">Enter at least two non-padding characters to search.</p> : null}
      {dirty && <p role="status" className="text-xs text-warning">Query draft not applied. Results still use the saved query. Apply or discard the draft before changing record type or page.</p>}
      {loading && <p role="status" className="text-sm text-surface-300">Searching current owned records...</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-danger"><p>{error} Matching counts and absence of records are unknown.</p><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs">Retry full workspace search</button></div>}
      {!loading && !error && result && <>
        <div role="group" aria-label="Search record type" className="flex flex-wrap gap-2">{Object.entries(GROUPS).map(([key, label]) => <button type="button" key={key} aria-pressed={kind === key} disabled={dirty} onClick={() => apply(query, key as Kind)} className={`rounded border px-3 py-2 text-xs disabled:opacity-40 ${kind === key ? 'border-primary-500 text-primary-300' : 'border-surface-600 text-surface-300'}`}>{label} ({result.totals[key as Kind]})</button>)}</div>
        <p role="status" className="break-words text-xs text-surface-400">{result.total} matching {GROUPS[kind].toLowerCase()} for "{query}". Page {page} of {Math.max(1, Math.ceil(result.total / 20))}. Read at {result.retrieved_at}. Counts and pages are separate current reads, not a frozen snapshot.</p>
        <p className="text-xs text-surface-400">Alerts, investigations and events use newest saved timestamp then ID. Assets and incidents use asset name then ID. Incidents require at least two currently active owned alerts, not a saved incident record or proof of attack.</p>
        {result.records.length ? <ul className="space-y-3">{result.records.map(row => <li key={kind === 'incidents' ? row.asset_id : row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
          <h2 className="break-words text-sm font-semibold text-surface-100">#{row.id ?? row.asset_id}: {row.title ?? row.name ?? row.asset_name ?? (row.signature || `${row.event_type} event`)}</h2>
          <p className="break-words text-xs text-surface-400">{kind === 'assets' ? `${row.asset_type} · ${row.vendor || 'Vendor not recorded'}` : kind === 'incidents' ? `${row.max_severity} · ${row.alert_count} active alerts` : kind === 'events' ? `${row.severity || 'Severity not recorded'} · ${row.event_type} · ${row.timestamp} · ${row.source_ip || 'Source not recorded'} → ${row.dest_ip || 'Destination not recorded'}` : `${row.severity} · ${row.status}`}</p>
          <Link to={locator(row, kind)} className="inline-block text-xs text-primary-300 underline">Open exact {kind === 'incidents' ? 'asset incident' : kind === 'cases' ? 'investigation' : kind === 'assets' ? 'asset' : kind === 'events' ? 'saved event' : 'alert'} #{row.id ?? row.asset_id}</Link>
        </li>)}</ul> : <div className="space-y-2"><p className="text-sm text-surface-400">No records on this page. Other record types or pages may have matches.</p>{page > 1 && <button type="button" disabled={dirty} onClick={() => apply(query, kind)} className="text-xs text-primary-300">Return to first search page</button>}</div>}
        <nav aria-label="Full search pages" className="flex flex-wrap gap-3 text-xs text-surface-300"><button type="button" disabled={dirty || page === 1} onClick={() => apply(query, kind, page - 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Previous search page</button><button type="button" disabled={dirty || page * 20 >= result.total} onClick={() => apply(query, kind, page + 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Next search page</button><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-3 py-2">Refresh current search</button></nav>
      </>}
    </section></div>;
}
