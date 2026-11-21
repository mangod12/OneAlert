import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Evidence { technique_id: string; technique_name: string; kind: string; query: string; rule_state: string; page: number; size: number; total: number; counts: { cases: number; detection_rules: number; enabled_rules: number; disabled_rules: number }; records: { id: number; title?: string; status?: string; name?: string; enabled?: boolean }[]; retrieved_at: string }
export function MitreReferenceExplorer({ initialTechnique = '' }: { initialTechnique?: string } = {}) {
  const [draft, setDraft] = useState(initialTechnique), [technique, setTechnique] = useState(initialTechnique);
  const [queryDraft, setQueryDraft] = useState(''), [query, setQuery] = useState('');
  const [kind, setKind] = useState('cases'), [state, setState] = useState('all'), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<Evidence | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setData(null); setError('');
    if (!technique) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Evidence>(`/mitre/techniques/${encodeURIComponent(technique)}/reference-evidence`, { params: { kind, page, size: 10, query, rule_state: state } }).then(({ data: result }) => {
      if (request !== reads.current) return;
      if (!result || result.technique_id !== technique || result.kind !== kind || result.page !== page || result.size !== 10 || result.query !== query || result.rule_state !== state || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.records) || result.records.length > 10 || !result.counts || Object.values(result.counts).some(value => !Number.isSafeInteger(value) || value < 0) || result.counts.enabled_rules + result.counts.disabled_rules > result.counts.detection_rules || result.records.some(row => !Number.isSafeInteger(row.id) || row.id <= 0 || (kind === 'cases' ? typeof row.title !== 'string' || typeof row.status !== 'string' : typeof row.name !== 'string' || typeof row.enabled !== 'boolean' || (state !== 'all' && row.enabled !== (state === 'enabled')))) || new Set(result.records.map(row => row.id)).size !== result.records.length) throw new Error('Reference evidence did not match the technique, filters or page. Retry the read.');
      const last = Math.max(1, Math.ceil(result.total / 10)); if (page > last) { setPage(last); return; }
      setData(result);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Technique reference evidence could not be loaded.')); })
      .finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [technique, kind, page, query, state, retry]);
  const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
  return <section aria-label="Full technique reference evidence" className="oa-panel space-y-3 p-4">
    <h2 className="text-base font-semibold text-surface-100">Explore all recorded technique references</h2>
    <p className="text-xs text-surface-400">Read all owned cases and saved detection rules for one exact catalog technique, including disabled rules and references beyond the 20-row previews. An association or enabled rule does not prove tested or live detection. Counts precede search and rule-state filters. Sub-techniques are not folded into their parent technique. No rule or case is changed.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setTechnique(draft.trim().toUpperCase()); setPage(1); setRetry(value => value + 1); }}><label className="text-xs text-surface-300">Exact technique ID<input aria-label="Reference evidence technique ID" maxLength={30} value={draft} onChange={event => setDraft(event.target.value)} placeholder="T1190" className={`${control} mt-1 block`} /></label><button type="submit" disabled={!draft.trim()} className={control}>Load full technique references</button></form>
    {draft.trim().toUpperCase() !== technique && <p className="text-xs text-warning">Technique draft not applied. Current technique: {technique || 'none'}.</p>}
    {technique && <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setQuery(queryDraft.trim()); setPage(1); setRetry(value => value + 1); }}>
        <label className="text-xs text-surface-300">Reference kind<select aria-label="Technique reference kind" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }} className={`${control} mt-1 block`}><option value="cases">Cases</option><option value="detection_rules">Detection rules</option></select></label>
        <label className="min-w-[12rem] flex-1 text-xs text-surface-300">Search current reference kind<input aria-label="Search technique references" maxLength={200} value={queryDraft} onChange={event => setQueryDraft(event.target.value)} className={`${control} mt-1 block w-full`} /></label><button type="submit" className={control}>Search technique references</button>
        {kind === 'detection_rules' && <label className="text-xs text-surface-300">Rule state<select aria-label="Technique reference rule state" value={state} onChange={event => { setState(event.target.value); setPage(1); }} className={`${control} mt-1 block`}><option value="all">All rules</option><option value="enabled">Enabled rules</option><option value="disabled">Disabled rules</option></select></label>}
        <button type="button" onClick={() => { setQuery(''); setQueryDraft(''); setState('all'); setPage(1); }} className={control}>Clear reference filters</button>
      </form>
      {queryDraft.trim() !== query && <p className="text-xs text-warning">Reference search draft not applied. Current keyword: {query || 'any'}.</p>}
      <p className="text-xs text-surface-400">Literal case-insensitive search covers displayed reference fields and IDs, not rule content or case evidence. Pages use created time, then ID, newest first. Counts and pages are separate current reads, not a frozen snapshot.</p>
      {loading && <p role="status" className="text-sm text-surface-300">Loading reference evidence...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loading && !error && data && data.page === page && data.technique_id === technique && <>
        <p className="break-words text-sm text-surface-100">{data.technique_id}: {data.technique_name}</p>
        <p className="text-xs text-surface-300">Full reference set: {data.counts.cases} cases; {data.counts.detection_rules} rules, {data.counts.enabled_rules} enabled and {data.counts.disabled_rules} disabled.</p>
        <p className="break-words text-xs text-surface-400">{data.total} matching {kind === 'cases' ? 'cases' : 'rules'} · Page {page} of {Math.max(1, Math.ceil(data.total / 10))} · Received {data.retrieved_at}</p>
        {!data.records.length && <p className="text-xs text-surface-300">No recorded references match this technique and filter scope.</p>}
        <ol className="space-y-2">{data.records.map(row => <li key={row.id} className="min-w-0 rounded border border-surface-700 p-3 text-xs text-surface-300">{kind === 'cases' ? <><Link to={`/cases/${row.id}`} className="break-words text-primary-300">Open exact case #{row.id}: {row.title}</Link><p className="mt-1">Recorded status: {row.status}</p></> : <><p className="break-words font-semibold">Rule #{row.id}: {row.name}</p><p className="mt-1">Recorded state: {row.enabled ? 'enabled' : 'disabled'}</p><Link to="/hunt" className="mt-2 inline-block text-primary-300">Open Hunt Lab to find this saved rule by name</Link></>}</li>)}</ol>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className={control}>Previous technique references</button><button type="button" disabled={page * 10 >= data.total} onClick={() => setPage(value => value + 1)} className={control}>More technique references</button></div>
      </>}
      <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)} className={control}>Refresh full technique references</button>
    </>}
  </section>;
}
