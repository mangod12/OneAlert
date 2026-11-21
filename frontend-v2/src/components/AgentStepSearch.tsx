import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { AgentRunInspector } from './AgentRunInspector';
const fields = ['action', 'tool_used', 'input_summary', 'output_summary'] as const;
type Field = typeof fields[number];
interface Filters { query: string; field: 'all' | Field; agent_type: string; run_status: string }
interface Excerpt { text: string | null; shortened: boolean; recorded_length: number | null }
interface StepMatch { step_id: number; run_id: number; step_number: number; agent_type: string; run_status: string; run_started_at: string | null; matched_fields: Field[]; excerpts: Record<Field, Excerpt> }
interface Result extends Filters { page: number; size: number; total: number; records: StepMatch[]; retrieved_at: string; excerpt_limit: number; scope: string }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const initial: Filters = { query: '', field: 'all', agent_type: '', run_status: '' };
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function AgentStepSearch() {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(initial), [filters, setFilters] = useState<Filters | null>(null);
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [selected, setSelected] = useState<number | null>(null);
  const [data, setData] = useState<Result | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const request = useRef(0), dirty = filters !== null && JSON.stringify(draft) !== JSON.stringify(filters);
  useEffect(() => {
    const read = ++request.current; setData(null); setError('');
    if (!open || !filters) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Result>('/cases/agents/step-search', { params: { ...filters, page, size: 10 } }).then(({ data: value }) => {
      if (read !== request.current) return;
      if (!value || Object.entries(filters).some(([key, text]) => value[key as keyof Filters] !== text) || value.page !== page || value.size !== 10 || !count(value.total) || value.excerpt_limit !== 500 || typeof value.scope !== 'string' || typeof value.retrieved_at !== 'string' || !Number.isFinite(Date.parse(value.retrieved_at)) || !Array.isArray(value.records) || value.records.length > 10 || new Set(value.records.map(row => row?.step_id)).size !== value.records.length || value.records.some(row => !row || !count(row.step_id) || row.step_id < 1 || !count(row.run_id) || row.run_id < 1 || !count(row.step_number) || typeof row.agent_type !== 'string' || typeof row.run_status !== 'string' || (row.run_started_at !== null && (typeof row.run_started_at !== 'string' || !Number.isFinite(Date.parse(row.run_started_at)))) || (filters.agent_type && row.agent_type !== filters.agent_type) || (filters.run_status && row.run_status !== filters.run_status) || !Array.isArray(row.matched_fields) || !row.matched_fields.length || new Set(row.matched_fields).size !== row.matched_fields.length || row.matched_fields.some(key => !fields.includes(key) || (filters.field !== 'all' && key !== filters.field)) || !row.excerpts || fields.some(key => { const excerpt = row.excerpts[key]; return !excerpt || typeof excerpt.shortened !== 'boolean' || (excerpt.text === null ? excerpt.recorded_length !== null || excerpt.shortened : typeof excerpt.text !== 'string' || Array.from(excerpt.text).length > 500 || !count(excerpt.recorded_length) || excerpt.recorded_length < Array.from(excerpt.text).length); }))) throw Error('Recorded step search did not match the applied query and complete page. Retry before relying on it.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (page > last) { setPage(last); return; }
      if (value.records.length !== Math.min(10, Math.max(0, value.total - (page - 1) * 10))) throw Error('Recorded step search returned an incomplete page. Retry before relying on it.');
      setData(value);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Recorded step search unavailable. No absence of activity is inferred.')); })
      .finally(() => { if (read === request.current) setLoading(false); });
    const invalidate = () => { request.current++; }; return invalidate;
  }, [open, filters, page, retry]);
  return <section aria-label="Search recorded steps across owned runs" className="oa-panel space-y-3 p-4 sm:p-6">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="text-sm font-semibold text-primary-300">Find recorded step evidence across all owned runs</button>
    {open && <>
      <p className="text-xs text-surface-400">Search saved step action/tool labels and input/output summaries across all runs owned by your account, beyond recent run lists. Literal search applies before server paging. Recorded summaries can already be shortened. No raw transcript, provider errors, run result summaries or unrecorded activity is searched. A recorded label or run status is not proof of external activity or success. Nothing is rerun.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (!draft.query.trim()) return; const applied = { ...draft, query: draft.query.trim(), agent_type: draft.agent_type.trim(), run_status: draft.run_status.trim() }; setFilters(applied); setDraft(applied); setPage(1); setRetry(value => value + 1); }}>
        <label className="min-w-0 basis-full flex-1 text-xs text-surface-300 sm:basis-64">Literal recorded-step text<input aria-label="Search all owned recorded steps" type="search" maxLength={200} value={draft.query} onChange={event => setDraft(value => ({ ...value, query: event.target.value }))} className={`${control} mt-1 block w-full`} /></label>
        <label className="text-xs text-surface-300">Search field<select aria-label="Cross-run step search field" value={draft.field} onChange={event => setDraft(value => ({ ...value, field: event.target.value as Filters['field'] }))} className={`${control} mt-1 block`}><option value="all">All recorded step text</option>{fields.map(key => <option key={key} value={key}>{key.replaceAll('_', ' ')}</option>)}</select></label>
        {([['agent_type', 'Exact recorded agent type'], ['run_status', 'Exact recorded run status']] as const).map(([key, label]) => <label key={key} className="max-w-full text-xs text-surface-300">{label}<input aria-label={label} maxLength={100} value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} className={`${control} mt-1 block w-full`} /></label>)}
        <button type="submit" disabled={!draft.query.trim()} className={control}>Search recorded step evidence</button>
        <button type="button" className={control} onClick={() => { request.current++; setDraft(initial); setFilters(null); setData(null); setError(''); setLoading(false); setPage(1); }}>Clear recorded step search</button>
      </form>
      {dirty && <p role="status" className="text-xs text-warning">Search drafts are not applied. Results still use the last submitted scope; apply or clear before paging.</p>}
      {loading && <p role="status" className="text-sm text-surface-300">Searching currently saved owned-run steps...</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className={control} onClick={() => setRetry(value => value + 1)}>Retry recorded step search</button></div>}
      {!loading && !error && data && <>
        <p role="status" className="break-words text-xs text-surface-400">{data.total} matching recorded steps · Page {page} of {Math.max(1, Math.ceil(data.total / 10))} · Read {data.retrieved_at}. Current records may change between pages, not an immutable snapshot.</p>
        {!data.records.length && <p className="text-sm text-surface-400">No saved owned-run step summaries match this scope. Missing matches do not establish that the activity did not occur.</p>}
        <p className="text-xs text-surface-400">Each field excerpt is at most 500 recorded characters and is centered near its first match when possible. Shortened excerpts can omit text. Open the exact run to inspect its full saved step summaries; the recorder may already have shortened them.</p>
        <ol aria-label="Cross-run recorded step matches" className="space-y-3">{data.records.map(row => <li key={row.step_id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
          <h3 className="break-words text-sm font-semibold text-surface-100">Run #{row.run_id} · Step {row.step_number} · Record #{row.step_id}</h3>
          <p className="break-words text-xs text-surface-400">{row.agent_type} · Recorded status {row.run_status} · Started {row.run_started_at ?? 'not recorded'} · Matched fields: {row.matched_fields.map(key => key.replaceAll('_', ' ')).join(', ')}</p>
          <dl className="space-y-2">{fields.map(key => <div key={key}><dt className="text-xs text-surface-400">{key.replaceAll('_', ' ')}{row.excerpts[key].shortened ? ` · shortened excerpt of ${row.excerpts[key].recorded_length} recorded characters` : ''}</dt><dd className="whitespace-pre-wrap break-words text-xs text-surface-300">{row.excerpts[key].text === null ? '(not recorded)' : row.excerpts[key].text === '' ? '(empty recorded text)' : row.excerpts[key].text}</dd></div>)}</dl>
          <button type="button" className={control} onClick={() => setSelected(row.run_id)}>Inspect exact run #{row.run_id} for step record #{row.step_id}</button>
        </li>)}</ol>
        <nav aria-label="Cross-run step search pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={dirty || page === 1} onClick={() => setPage(page - 1)}>Previous step search page</button><button type="button" className={control} disabled={dirty || page * 10 >= data.total} onClick={() => setPage(page + 1)}>More step search matches</button><button type="button" className={control} disabled={dirty} onClick={() => setRetry(value => value + 1)}>Refresh applied step search</button></nav>
      </>}
    </>}
    {selected !== null && <AgentRunInspector key={selected} runId={selected} onClose={() => setSelected(null)} />}
  </section>;
}
