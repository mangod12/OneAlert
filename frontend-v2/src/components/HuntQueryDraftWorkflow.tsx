import { HuntExactDraftExecutionComparison } from './HuntExactDraftExecutionComparison';
import { HuntDraftExecutions } from './HuntDraftExecutions';
import { HuntAuthoredQueryEditor } from './HuntAuthoredQueryEditor';
import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { HuntRunLink } from './HuntRunLink';
import { HuntQueryRefinementEditor } from './HuntQueryRefinementEditor';
import { HuntDraftSourceComparison } from './HuntDraftSourceComparison';
import { parseHuntQueryDraft, parseReviewedHuntResult, type HuntQueryDraft } from '../utils/huntQueryDraft';
import { saveHuntDownload, type HuntEvidenceResult } from '../utils/huntEvidence';
const control = 'min-h-10 max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function HuntQueryDraftWorkflow({ hypothesis, savedDraftId = null, disabled, onBusyChange, onSaved, onExecuted, onSavedHypothesis }: { hypothesis: string; savedDraftId?: number | null; disabled: boolean; onBusyChange: (value: boolean) => void; onSaved: () => void; onExecuted: (value: HuntEvidenceResult) => void; onSavedHypothesis?: (value: string) => void }) {
  const [data, setData] = useState<HuntQueryDraft | null>(null), [selected, setSelected] = useState<number[]>([]), [busy, setBusy] = useState(''), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false), [downloadError, setDownloadError] = useState('');
  const [editing, setEditing] = useState(false), [authoring, setAuthoring] = useState(false);
  const request = useRef(0), inFlight = useRef(false);
  const toggleEditing = (value: boolean) => { setEditing(value); setSelected([]); setError(''); onBusyChange(value); };
  const toggleAuthoring = (value: boolean) => { setAuthoring(value); setSelected([]); setError(''); onBusyChange(value); };
  useEffect(() => {
    const invalidate = () => { request.current++; inFlight.current = false; onBusyChange(false); };
    if (savedDraftId === null) return invalidate;
    const version = ++request.current; inFlight.current = true; setBusy('reload'); onBusyChange(true); setError('');
    void apiClient.get(`/hunt/query-drafts/${savedDraftId}`).then(({ data: value }) => { if (version === request.current) { const parsed = parseHuntQueryDraft(value, { id: savedDraftId }); setData(parsed); setSelected([]); onSavedHypothesis?.(parsed.hypothesis); } }).catch(reason => { if (version === request.current) setError(getApiErrorMessage(reason, 'Saved query draft could not be loaded. No execution was started.')); }).finally(() => { if (version === request.current) { inFlight.current = false; setBusy(''); onBusyChange(false); } });
    return invalidate;
  }, [savedDraftId, onBusyChange, onSavedHypothesis]);
  const generate = async () => {
    if (inFlight.current || disabled || !hypothesis.trim() || uncertain || editing || authoring) return;
    const version = ++request.current, requestedHypothesis = hypothesis; inFlight.current = true; setBusy('prepare'); onBusyChange(true); setError(''); setSelected([]); setData(null);
    try { const response = await apiClient.post('/hunt/query-drafts', { hypothesis: requestedHypothesis }); if (version !== request.current) return; onSaved(); if (response.data.success !== true) throw Error('Query draft generation did not complete. No event query was requested. Inspect Hunt History and the run ledger before generating again.'); setData(parseHuntQueryDraft(response.data.data, { hypothesis: requestedHypothesis })); }
    catch (reason) { if (version === request.current) setError(getApiErrorMessage(reason, 'Query draft generation failed. No event query was requested; inspect history before retrying.')); }
    finally { if (version === request.current) { inFlight.current = false; setBusy(''); onBusyChange(false); } }
  };
  const reload = async () => {
    if (!data || inFlight.current || disabled || uncertain || editing || authoring) return;
    const version = ++request.current, identity = data.session_id; inFlight.current = true; setBusy('reload'); onBusyChange(true); setError(''); setSelected([]); setData(null);
    try { const response = await apiClient.get(`/hunt/query-drafts/${identity}`); if (version === request.current) setData(parseHuntQueryDraft(response.data, { id: identity })); }
    catch (reason) { if (version === request.current) setError(getApiErrorMessage(reason, 'Saved query draft could not be refreshed. No execution was started.')); }
    finally { if (version === request.current) { inFlight.current = false; setBusy(''); onBusyChange(false); } }
  };
  const changedHypothesis = data !== null && data.hypothesis !== hypothesis;
  const execute = async () => {
    if (!data || !data.can_execute || changedHypothesis || !selected.length || inFlight.current || disabled || uncertain || editing || authoring) return;
    const version = ++request.current, source = data, chosen = [...selected].sort((a,b) => a-b); inFlight.current = true; setBusy('execute'); onBusyChange(true); setError('');
    try { const response = await apiClient.post(`/hunt/query-drafts/${source.session_id}/execute`, { fingerprint: source.fingerprint, query_numbers: chosen }); if (version !== request.current) return; const result = parseReviewedHuntResult(response.data.data, source, chosen); setSelected([]); onExecuted(result); }
    catch (reason) { if (version === request.current) { const status = (reason as { response?: { status?: number } })?.response?.status; const notStarted = status === 400 || status === 401 || status === 404 || status === 409 || status === 422; onSaved(); setUncertain(!notStarted); setSelected([]); if (notStarted) setData(value => value ? { ...value, can_execute: false } : value); setError(notStarted ? getApiErrorMessage(reason, 'Selection was refused. Reload the saved draft and review it before choosing again.') : 'Execution could not be confirmed. It may have run. Inspect Hunt History and the run ledger before choosing another action.'); } }
    finally { if (version === request.current) { inFlight.current = false; setBusy(''); onBusyChange(false); } }
  };
  const download = () => { if (!data || busy || editing) return; try { saveHuntDownload(JSON.stringify({ format: 'onealert_saved_query_draft_review_v1', exported_at: new Date().toISOString(), ...data, download_scope: 'Loaded compiler-only query draft. No event results. Hypothesis, SQL and parameters may be sensitive. Keep private; copies have no application access controls.' }, null, 2) + '\n', `hunt-${data.session_id}-query-draft.json`, 'application/json'); setDownloadError(''); } catch { setDownloadError('The loaded query draft could not be downloaded. No execution was requested.'); } };
  return <section aria-label="Review generated hunt queries before execution" className="mt-4 min-w-0 space-y-3 rounded border border-primary-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Review queries before running them</h3>
    <p className="text-xs text-surface-400">Generate a saved query draft using the configured AI provider, or keyword fallback if unavailable. You can also write a compiler-only draft without AI. This prepares and validates queries without reading event rows. Provider usage may apply. Choose queries separately to read current owned events. The existing Hunt button still generates and runs queries directly.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={!!busy || disabled || !hypothesis.trim() || uncertain || editing || authoring} onClick={() => void generate()}>Generate query draft only</button>
    <button type="button" className={control} disabled={!!busy || disabled || !hypothesis.trim() || uncertain || editing || authoring} onClick={() => toggleAuthoring(true)}>Write query draft without AI</button></div>
    {authoring && <HuntAuthoredQueryEditor hypothesis={hypothesis} onCancel={() => toggleAuthoring(false)} onRecorded={onSaved} onSaved={value => { setData(value); toggleAuthoring(false); }} />}
    {busy && <p role="status" className="text-xs text-surface-300">{busy === 'prepare' ? 'Generating and compiling a saved query draft. No event query is requested...' : busy === 'execute' ? 'Executing only the selected saved queries against current owned events...' : 'Reading the exact saved query draft...'}</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-danger">{error}</p>}
    {uncertain && <p className="text-xs text-warning">Execution may already have run. Automatic retry is disabled. Inspect Hunt History and the run ledger to establish what happened before leaving this review and choosing another action. Use Refresh hunt history to check again.</p>}
    {data && !authoring && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-surface-100">Saved query draft #{data.session_id}</h4><button type="button" className={control} disabled={!!busy || disabled || uncertain || editing || authoring} onClick={() => void reload()}>Reload saved query draft</button></div>
      <p className="whitespace-pre-wrap break-words text-sm text-surface-300">Draft hypothesis: {data.hypothesis}</p><a className="text-xs text-primary-300 underline" href={`/app/hunt?query_draft=${data.session_id}`}>Open this exact saved query draft</a><HuntRunLink runId={data.agent_run_id} />
      <p className="break-words text-xs text-surface-400">Prepared {data.draft.prepared_at}. Expires {data.draft.expires_at}. Generation: {data.draft.generation_method === 'analyst_refinement' ? 'Analyst refinement, no new AI call' : data.draft.generation_method === 'analyst_authored' ? 'Analyst authored, no AI call' : data.draft.generation_method}. No event SELECT was executed during preparation. A completed preparation run is not a completed event search.</p>
      <p className="text-xs text-surface-400">{data.draft.scope}</p>
      {changedHypothesis && <p className="text-xs text-warning">The hypothesis input differs from this saved draft. Generate a new draft or restore its exact hypothesis before execution.</p>}
      {!data.can_execute && <p className="text-xs text-warning">This saved draft cannot currently be executed. It may be outside its one-hour execution window or have no supported queries. Create or refine a draft for a fresh review window; no query is regenerated automatically.</p>}
      {data.draft.explanation && <p className="whitespace-pre-wrap break-words text-xs text-surface-300">{data.draft.refinement ? 'Source explanation (copied, not regenerated)' : 'Proposed explanation'}{data.draft.explanation_shortened ? ' (shortened)' : ''}: {data.draft.explanation}</p>}
      {data.draft.omitted_query_count > 0 && <p className="text-xs text-warning">{data.draft.omitted_query_count} generated queries omitted by the three-query draft cap. They cannot be selected here.</p>}
      {data.draft.refinement && <div className="space-y-2 break-words text-xs text-warning"><p>Analyst-refined from <a className="text-primary-300 underline" href={`/app/hunt?query_draft=${data.draft.refinement.source_session_id}`}>saved draft #{data.draft.refinement.source_session_id}</a>. Edited original queries: {data.draft.refinement.edited_query_numbers.join(', ')}.</p>{data.draft.refinement.source_omitted_query_count > 0 && <p>{data.draft.refinement.source_omitted_query_count} queries omitted from that source are not recovered.</p>}<p>Descriptions and explanation are copied, not regenerated. Review the new SQL and compiler contracts before selecting queries.</p><details><summary className="cursor-pointer text-primary-300">Refinement scope</summary><p className="mt-2">{data.draft.refinement.scope}</p></details></div>}
      {data.draft.refinement && <HuntDraftSourceComparison key={`${data.session_id}:${data.fingerprint}`} refined={data} disabled={!!busy || disabled || editing || uncertain} />}
      {!editing && <HuntDraftExecutions key={`executions:${data.session_id}:${data.fingerprint}`} source={data} disabled={!!busy || disabled} />}
      {!editing && <HuntExactDraftExecutionComparison key={`comparison:${data.session_id}:${data.fingerprint}`} source={data} disabled={!!busy || disabled} />}
      {!editing && <button type="button" className={control} disabled={!!busy || disabled || uncertain || changedHypothesis} onClick={() => toggleEditing(true)}>Refine SQL and parameters</button>}
      {editing && <HuntQueryRefinementEditor source={data} onCancel={() => toggleEditing(false)} onRecorded={onSaved} onSaved={value => { setData(value); toggleEditing(false); }} />}
      {data.draft.queries.map(query => <article key={query.position} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><label className="flex items-start gap-2"><input type="checkbox" aria-label={`Select original draft query ${query.position}`} checked={selected.includes(query.position)} disabled={!query.accepted || !data.can_execute || changedHypothesis || !!busy || disabled || uncertain || editing || authoring} onChange={event => setSelected(values => event.target.checked ? [...values, query.position] : values.filter(value => value !== query.position))} /><span>Original query {query.position} · {query.accepted ? 'Supported compiler contract, not executed' : 'Rejected, cannot execute'}</span></label>
        <p className="whitespace-pre-wrap break-words">{data.draft.refinement ? 'Copied source description: ' : ''}{query.description}{query.description_shortened ? ' (description shortened)' : ''}</p>{query.sql !== null && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-950 p-2">{query.sql}</pre>}
        <details><summary className="cursor-pointer text-primary-300">Exact saved parameters and applied absolute time bounds</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ parameters: query.params, applied_time_window: query.time_window }, null, 2)}</pre></details>
        {query.execution && <p>Selected columns: {query.execution.selected_columns.join(', ')}. Order: {query.execution.order_by} {query.execution.direction}{query.execution.tie_breaker ? `, id ${query.execution.tie_breaker.direction}` : ''}. At most {query.execution.row_limit} rows.{Object.keys(query.time_window).length === 0 ? ' No time bounds are applied.' : ' Since is inclusive; before is exclusive where supplied. Saved bounds do not advance when executed.'} Compiler acceptance does not estimate query cost or establish that any events match.</p>}
        {query.error && <p className="text-danger">{query.error}</p>}
      </article>)}
      <button type="button" className={control} disabled={!!busy || disabled || !data.can_execute || changedHypothesis || !selected.length || uncertain || editing || authoring} onClick={() => void execute()}>Run {selected.length} selected saved {selected.length === 1 ? 'query' : 'queries'}</button>
      <p className="text-xs text-surface-400">Creates a separate hunt result and run ledger. Reads then-current owned event rows using only selected saved SQL and parameters. No second AI call, changed time window, detection installation or response action. A repeated explicit run can read different current rows.</p>
      <button type="button" className={control} disabled={!!busy || editing} onClick={download}>Download loaded query draft JSON</button><p className="text-xs text-surface-400">Contains the loaded hypothesis, SQL and parameters, not event results. Keep private. No extra read or sharing.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
