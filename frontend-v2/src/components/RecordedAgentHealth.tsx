import { AgentHealthRuns, type HealthRunScope } from './AgentHealthRuns';
import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
import { AgentRunInspector } from './AgentRunInspector';
interface Filters { from_date: string; before_date: string; agent_type: string }
interface Group { agent_type: string; status: string; count: number; first_started_at: string | null; last_started_at: string | null }
interface Health { from_date: string | null; before_date: string | null; agent_type: string; retrieved_at: string; total: number; groups: Group[]; oldest_running: { id: number; agent_type: string; started_at: string | null }[]; scope: string }
const control = 'max-w-full min-h-10 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const initial = { from_date: '', before_date: '', agent_type: '' };
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown) => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
export function RecordedAgentHealth() {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(initial), [applied, setApplied] = useState<Filters | null>(null), [data, setData] = useState<Health | null>(null);
  const [retry, setRetry] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState(''), [selected, setSelected] = useState<number | null>(null);
  const [runScope, setRunScope] = useState<HealthRunScope | null>(null);
  const [groupFilter, setGroupFilter] = useState(''), [page, setPage] = useState(1);
  const request = useRef(0), dirty = applied !== null && JSON.stringify(draft) !== JSON.stringify(applied);
  useEffect(() => {
    const read = ++request.current; setData(null); setError(''); setDownloadError(''); setRunScope(null); setGroupFilter(''); setPage(1);
    if (!open || !applied) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Health>('/cases/agents/recorded-health', { params: { agent_type: applied.agent_type, ...(applied.from_date ? { from_date: applied.from_date } : {}), ...(applied.before_date ? { before_date: applied.before_date } : {}) } }).then(({ data: value }) => {
      if (read !== request.current) return;
      if (!value || value.from_date !== (applied.from_date || null) || value.before_date !== (applied.before_date || null) || value.agent_type !== applied.agent_type || typeof value.retrieved_at !== 'string' || !timestamp(value.retrieved_at) || typeof value.scope !== 'string' || !count(value.total) || !Array.isArray(value.groups) || value.groups.length > 1000 || new Set(value.groups.map(row => JSON.stringify([row?.agent_type, row?.status]))).size !== value.groups.length || value.groups.some(row => !row || typeof row.agent_type !== 'string' || typeof row.status !== 'string' || !count(row.count) || row.count < 1 || !timestamp(row.first_started_at) || !timestamp(row.last_started_at) || (applied.agent_type && row.agent_type !== applied.agent_type)) || value.groups.reduce((sum, row) => sum + row.count, 0) !== value.total || !Array.isArray(value.oldest_running) || value.oldest_running.length > 5 || new Set(value.oldest_running.map(row => row?.id)).size !== value.oldest_running.length || value.oldest_running.some(row => !row || !count(row.id) || row.id < 1 || typeof row.agent_type !== 'string' || !timestamp(row.started_at) || (applied.agent_type && row.agent_type !== applied.agent_type))) throw Error('Recorded health did not match the complete requested scope and counts. Retry before relying on it.');
      setData(value);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Recorded execution health unavailable. No absence of failures or runs is inferred.')); }).finally(() => { if (read === request.current) setLoading(false); });
    const invalidate = () => { request.current++; }; return invalidate;
  }, [open, applied, retry]);
  const statuses = [...new Set(data?.groups.map(row => row.status) ?? [])], groups = data?.groups.filter(row => !groupFilter || JSON.stringify(row.status) === groupFilter) ?? [];
  const pages = Math.max(1, Math.ceil(groups.length / 20)), currentPage = Math.min(page, pages);
  const download = () => {
    if (!data || dirty) return;
    setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_recorded_agent_health_v1', exported_at: new Date().toISOString(), ...data }, null, 2) + '\n', 'recorded-agent-health.json', 'application/json'); }
    catch { setDownloadError('The loaded recorded-health report could not be downloaded. No records changed.'); }
  };
  return <section aria-label="Recorded agent execution health" className="oa-panel space-y-3 p-4 sm:p-6">
    <button type="button" aria-expanded={open} className="text-sm font-semibold text-primary-300" onClick={() => { if (open) { request.current++; setApplied(null); setData(null); setRunScope(null); } setOpen(value => !value); }}>Review recorded agent execution health</button>
    {open && <>
      <p className="text-xs text-surface-400">Count all owned ledger runs by recorded agent type and status, not only the latest 50. Dates filter saved start times in UTC, not completion times or your local day. Empty bounds include all history. These are ledger states, not proof of incident outcome, provider availability, task quality or worker liveness. Running can be stale. Nothing is started, retried or cancelled.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const scope = { ...draft, agent_type: draft.agent_type.trim() }; setDraft(scope); setApplied(scope); setRetry(value => value + 1); }}>
        <label className="text-xs text-surface-300">From UTC date (inclusive)<input aria-label="Health from UTC date" type="date" value={draft.from_date} onChange={event => setDraft(value => ({ ...value, from_date: event.target.value }))} className={`${control} mt-1 block`} /></label>
        <label className="text-xs text-surface-300">Before UTC date (exclusive)<input aria-label="Health before UTC date" type="date" value={draft.before_date} onChange={event => setDraft(value => ({ ...value, before_date: event.target.value }))} className={`${control} mt-1 block`} /></label>
        <label className="min-w-0 text-xs text-surface-300">Exact recorded agent type<input aria-label="Health exact agent type" maxLength={100} value={draft.agent_type} onChange={event => setDraft(value => ({ ...value, agent_type: event.target.value }))} className={`${control} mt-1 block w-full`} /></label>
        <button type="submit" disabled={!!draft.from_date && !!draft.before_date && draft.from_date >= draft.before_date} className={control}>Read recorded execution health</button>
        <button type="button" className={control} onClick={() => { request.current++; setApplied(null); setRunScope(null); setDraft(initial); setData(null); setError(''); setLoading(false); setDownloadError(''); }}>Clear recorded health</button>
      </form>
      {!!draft.from_date && !!draft.before_date && draft.from_date >= draft.before_date && <p role="alert" className="text-xs text-warning">Before must be later than From; the before date is excluded.</p>}
      {dirty && <p role="status" className="text-xs text-warning">Draft dates or agent type are not applied. The displayed report still uses the last submitted scope; apply or clear before downloading.</p>}
      {loading && <p role="status" className="text-xs text-surface-300">Reading current recorded execution health...</p>}
      {error && <p role="alert" className="text-xs text-danger">{error} No absence of failures or runs is inferred. Use Read recorded execution health to retry.</p>}
      {data && !error && !loading && <>
        <p role="status" className="break-words text-sm text-surface-200">{data.total} owned recorded runs · {data.groups.length} agent/status groups · Read {data.retrieved_at}</p>
        <p className="text-xs text-surface-400">Applied UTC start window: {data.from_date ?? 'all earlier history'} inclusive to {data.before_date ?? 'no upper bound'} exclusive. Exact agent: {data.agent_type || 'all recorded agents'}. Current records can change; counts and oldest-running examples are separate reads, not an atomic snapshot.</p>
        <div className="flex flex-wrap gap-2">{statuses.map(status => <span key={status} className="break-words rounded border border-surface-700 p-2 text-xs text-surface-200">{status || '(empty status)'}: {data.groups.filter(row => row.status === status).reduce((sum, row) => sum + row.count, 0)}</span>)}</div>
        {!data.total && <p className="text-xs text-surface-400">No saved run records in this scope. This does not establish no execution or no security activity.</p>}
        <label className="block text-xs text-surface-300">Show recorded status groups<select aria-label="Health group status" value={groupFilter} onChange={event => { setGroupFilter(event.target.value); setPage(1); }} className={`${control} mt-1 block`}><option value="">All recorded statuses</option>{statuses.map(status => <option key={status} value={JSON.stringify(status)}>{status || '(empty status)'}</option>)}</select></label>
        <ul aria-label="Recorded health groups" className="grid gap-2 sm:grid-cols-2">{groups.slice((currentPage - 1) * 20, currentPage * 20).map(row => <li key={JSON.stringify([row.agent_type, row.status])} className="min-w-0 space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300"><h3 className="break-words text-sm font-semibold text-surface-100">{row.agent_type || '(empty agent type)'} · {row.status || '(empty status)'}</h3><p>{row.count} recorded runs</p><p className="break-words">First saved start: {row.first_started_at ?? 'not recorded'}<br />Last saved start: {row.last_started_at ?? 'not recorded'}</p><button type="button" disabled={dirty} className={control} onClick={() => setRunScope({ agent_type: row.agent_type, run_status: row.status, from_date: data.from_date, before_date: data.before_date, report_count: row.count, report_read_at: data.retrieved_at })}>Browse exact run group: {row.agent_type || '(empty agent type)'} / {row.status || '(empty status)'}</button></li>)}</ul>
        <nav aria-label="Recorded health group pages" className="flex flex-wrap items-center gap-2"><button type="button" disabled={currentPage === 1} className={control} onClick={() => setPage(currentPage - 1)}>Previous health groups</button><span className="text-xs text-surface-400">{groups.length} matching groups · Page {currentPage} of {pages}</span><button type="button" disabled={currentPage === pages} className={control} onClick={() => setPage(currentPage + 1)}>More health groups</button></nav>
        {runScope && <AgentHealthRuns key={JSON.stringify(runScope)} scope={runScope} onClose={() => setRunScope(null)} />}
        <section className="space-y-2"><h3 className="text-sm font-semibold text-surface-100">Oldest records marked running (up to five)</h3><p className="text-xs text-surface-400">Inspect their saved evidence before deciding on follow-up. Age is not a liveness check or proof of a hung worker. This list can differ from aggregate counts if records changed between reads.</p>{!data.oldest_running.length && <p className="text-xs text-surface-400">No running examples returned in this separate read.</p>}<div className="flex flex-wrap gap-2">{data.oldest_running.map(row => <button type="button" key={row.id} className={control} onClick={() => setSelected(row.id)}>Inspect running record #{row.id} · {row.agent_type} · {row.started_at ?? 'start not recorded'}</button>)}</div></section>
        <button type="button" disabled={dirty} className={control} onClick={download}>Download loaded recorded health JSON</button><p className="text-xs text-surface-400">Includes every loaded aggregate group across pages and all returned running examples, not only the displayed status filter. Contains account activity metadata. Keep private and review before sharing. No new read or message is sent; downloaded copies have no application access controls.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
      </>}
    </>}
    {selected !== null && <AgentRunInspector key={selected} runId={selected} onClose={() => setSelected(null)} />}
  </section>;
}
