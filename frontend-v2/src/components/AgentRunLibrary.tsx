import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { AgentRunInspector } from './AgentRunInspector';
interface Run { id: number; agent_type: string; status: string; started_at: string; completed_at: string | null; model_used: string | null; prompt_tokens: number; completion_tokens: number; result_summary: string | null; }
interface Filters { query: string; agent_type: string; run_status: string; model: string; }
interface Result extends Filters { page: number; size: number; total: number; retrieved_at: string; agent_types: string[]; statuses: string[]; models: string[]; records: Run[]; }
const initial = { query: '', agent_type: '', run_status: '', model: '' };
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function AgentRunLibrary() {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(initial), [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const request = useRef(0), dirty = JSON.stringify(draft) !== JSON.stringify(filters);
  useEffect(() => {
    const id = ++request.current; setResult(null); setError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Result>('/cases/agents/run-library', { params: { ...filters, page, size: 20 } }).then(({ data }) => {
      if (id !== request.current) return;
      const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
      const optional = (value: unknown) => value === null || typeof value === 'string';
      if (!data || Object.entries(filters).some(([key, value]) => data[key as keyof Filters] !== value) || data.page !== page || data.size !== 20 || !count(data.total) || !timestamp(data.retrieved_at)
        || [data.agent_types, data.statuses, data.models].some(values => !Array.isArray(values) || values.some(value => typeof value !== 'string') || new Set(values).size !== values.length)
        || !Array.isArray(data.records) || data.records.length > 20 || data.records.length > data.total || new Set(data.records.map(row => row?.id)).size !== data.records.length
        || data.records.some(row => !row || !count(row.id) || row.id < 1 || typeof row.agent_type !== 'string' || typeof row.status !== 'string' || !timestamp(row.started_at)
          || (row.completed_at !== null && !timestamp(row.completed_at)) || !optional(row.model_used) || !optional(row.result_summary) || !count(row.prompt_tokens) || !count(row.completion_tokens)
          || (filters.agent_type && row.agent_type !== filters.agent_type) || (filters.run_status && row.status !== filters.run_status) || (filters.model && row.model_used !== filters.model))) throw new Error('Run library did not match the requested record scope. Retry before relying on it.');
      setResult(data);
    }).catch(err => { if (id === request.current) setError(getApiErrorMessage(err, 'Recorded run library unavailable.')); })
      .finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [open, filters, page, retry]);
  return <section aria-label="Complete recorded agent run library" className="oa-panel space-y-4 p-4 sm:p-6">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="text-sm font-semibold text-primary-300">Explore all recorded agent runs beyond the latest 50</button>
    {open && <>
      <p className="text-xs text-surface-400">Search all current ledger runs owned by your account by ID, agent, status, model or saved result summary. Literal search applies before server paging. Step bodies and error messages are not searched. Saved summaries may be shortened; recorded status is not proof of successful external action, a full transcript or an immutable audit history.</p>
      <form onSubmit={event => { event.preventDefault(); setFilters({ ...draft, query: draft.query.trim() }); setDraft(value => ({ ...value, query: value.query.trim() })); setPage(1); }} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 basis-full flex-1 flex-col gap-1 text-xs text-surface-400 sm:basis-64">Search full run library<input type="search" aria-label="Search full run library" maxLength={200} value={draft.query} onChange={event => setDraft(value => ({ ...value, query: event.target.value }))} className={control} /></label>
        {([['agent_type', 'Agent type', 'agent_types'], ['run_status', 'Recorded run status', 'statuses'], ['model', 'Recorded model', 'models']] as const).map(([key, label, options]) => <label key={key} className="flex max-w-full flex-col gap-1 text-xs text-surface-400">{label}<select aria-label={label} value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} className={control}><option value="">All recorded values</option>{Array.from(new Set([...(result?.[options] ?? []), ...(draft[key] ? [draft[key]] : [])])).map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
        <button type="submit" className={control}>Apply run library filters</button>
        <button type="button" onClick={() => { setDraft(initial); setFilters(initial); setPage(1); }} className={control}>Clear run library filters</button>
      </form>
      {dirty && <p role="status" className="text-xs text-warning">Filter drafts are not applied. Apply or clear before paging; results still use the previous filters.</p>}
      {loading && <p role="status" className="text-sm text-surface-400">Loading full run library...</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-danger"><p>{error} No absence of runs or counts is inferred.</p><button type="button" onClick={() => setRetry(value => value + 1)} className={control}>Retry run library</button></div>}
      {!loading && !error && result && <>
        <p role="status" className="break-words text-xs text-surface-400">{result.total} matching runs · Page {page} of {Math.max(1, Math.ceil(result.total / 20))} · Read at {result.retrieved_at}. Newest start time then ID. Current records can change between pages, not a frozen snapshot.</p>
        {!result.records.length && <p className="text-sm text-surface-400">No run records on this page. Clear filters or return to the first page to check another scope.</p>}
        <ul className="space-y-3">{result.records.map(row => <li key={row.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
          <h3 className="break-words text-sm font-semibold text-surface-100">Run #{row.id} · {row.agent_type} · {row.status}</h3>
          <p className="break-words text-xs text-surface-400">Started {row.started_at} · Completed {row.completed_at || 'not recorded'} · Model {row.model_used || 'not recorded'}</p>
          <p className="text-xs text-surface-400">Recorded tokens: {row.prompt_tokens} prompt / {row.completion_tokens} completion. Token counts are not a price or spend total.</p>
          <p className="whitespace-pre-wrap break-words text-sm text-surface-300">{row.result_summary || 'No result summary recorded.'}</p>
          <button type="button" onClick={() => setSelected(row.id)} className={control}>Inspect library run #{row.id}</button>
        </li>)}</ul>
        <nav aria-label="Run library pages" className="flex flex-wrap gap-2"><button type="button" disabled={dirty || page === 1} onClick={() => setPage(value => value - 1)} className={control}>Previous run page</button><button type="button" disabled={dirty || page * 20 >= result.total} onClick={() => setPage(value => value + 1)} className={control}>Next run page</button>{page > 1 && <button type="button" disabled={dirty} onClick={() => setPage(1)} className={control}>First run page</button>}<button type="button" onClick={() => setRetry(value => value + 1)} className={control}>Refresh run library page</button></nav>
      </>}
    </>}
    {selected !== null && <AgentRunInspector key={selected} runId={selected} onClose={() => setSelected(null)} />}
  </section>;
}
