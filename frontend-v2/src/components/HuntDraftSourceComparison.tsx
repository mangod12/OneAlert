import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
import { parseHuntQueryDraft, type DraftQuery, type HuntQueryDraft } from '../utils/huntQueryDraft';
import { compareHuntDraftSource, huntDraftSourceComparisonPackage, type HuntDraftSourceComparison as DraftSourceComparison } from '../utils/huntDraftSourceComparison';

const control = 'min-h-10 max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
function QueryPane({ label, query }: { label: string; query: DraftQuery }) {
  return <section aria-label={`${label} query ${query.position}`} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
    <h6 className="text-xs font-semibold text-surface-100">{label}</h6>
    <p className="text-xs text-surface-300">{query.accepted ? 'Compiler-supported, not executed' : 'Compiler-rejected, cannot execute'}</p>
    {query.sql === null ? <p className="text-xs text-warning">SQL was not retained in this draft. No original text is inferred.</p> : <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-950 p-2 text-xs text-surface-300">{query.sql}</pre>}
    <p className="text-xs font-semibold text-surface-300">Exact parameters</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-surface-300">{JSON.stringify(query.params, null, 2)}</pre>
    <p className="text-xs font-semibold text-surface-300">Applied absolute UTC bounds</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-surface-300">{query.accepted ? Object.keys(query.time_window).length ? JSON.stringify(query.time_window, null, 2) : 'No applied timestamp bounds in this compiler contract.' : 'Unavailable: no accepted compiler contract.'}</pre>
    {query.execution && <p className="break-words text-xs text-surface-300">Selected columns: {query.execution.selected_columns.join(', ')}. Order: {query.execution.order_by} {query.execution.direction}{query.execution.tie_breaker ? `, id ${query.execution.tie_breaker.direction}` : ''}. Requested row limit: {query.execution.requested_limit ?? 'default'}. Applied row cap: {query.execution.row_limit}, not a result count.</p>}
    {query.error && <p className="whitespace-pre-wrap break-words text-xs text-warning">Compiler note: {query.error}</p>}
  </section>;
}

export function HuntDraftSourceComparison({ refined, disabled = false }: { refined: HuntQueryDraft; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [data, setData] = useState<DraftSourceComparison | null>(null), [downloadError, setDownloadError] = useState('');
  const request = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  const close = () => { request.current++; inFlight.current = false; setLoading(false); setOpen(false); setData(null); setError(''); setDownloadError(''); };
  const read = async () => {
    if (disabled || inFlight.current) return;
    const version = ++request.current;
    inFlight.current = true; setOpen(true); setLoading(true); setData(null); setError(''); setDownloadError('');
    try {
      const checked = parseHuntQueryDraft(refined), lineage = checked.draft.refinement;
      if (!lineage) throw Error('This draft has no recorded refinement source.');
      const response = await apiClient.get(`/hunt/query-drafts/${lineage.source_session_id}`);
      if (version === request.current) setData(compareHuntDraftSource(checked, response.data));
    } catch (reason) {
      if (version === request.current) setError(getApiErrorMessage(reason, 'The exact recorded source could not be compared. It may be unavailable or changed. No other source was substituted, and no query was run.'));
    } finally {
      if (version === request.current) { inFlight.current = false; setLoading(false); }
    }
  };
  const visible = data?.refined.session_id === refined.session_id && data.refined.fingerprint === refined.fingerprint ? data : null;
  const download = () => {
    if (!visible || loading || inFlight.current || disabled) return;
    try {
      const content = huntDraftSourceComparisonPackage(visible, new Date().toISOString());
      saveHuntDownload(content, `hunt-draft-${refined.session_id}-vs-source-${visible.source.session_id}.json`, 'application/json');
      setDownloadError('');
    } catch { setDownloadError('The loaded source comparison could not be downloaded. No extra read or execution was requested.'); }
  };
  if (!refined.draft.refinement) return null;
  return <section aria-label="Compare refined hunt draft with its recorded source" className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
    <h4 className="text-sm font-semibold text-surface-100">Review changes from the recorded source</h4>
    <p className="text-xs text-surface-400">Explicitly read only the source recorded by this saved refinement. Its fingerprint must match. Compares saved SQL, parameters and compiler fields, not event rows, unsaved edits or security outcomes. No AI call, event SELECT, preparation, execution or approval.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={disabled || loading} onClick={() => void read()}>{open ? 'Refresh exact source comparison' : 'Compare with recorded source'}</button>{open && <button type="button" className={control} onClick={close}>Close source comparison</button>}</div>
    {open && loading && <p role="status" className="text-xs text-surface-300">Reading the exact saved source draft. No event query requested...</p>}
    {open && error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-warning">{error}</p>}
    {open && visible && <>
      <p className="break-words text-xs text-surface-300">Source #{visible.source.session_id}, prepared {visible.source.draft.prepared_at}, read {visible.source.read_at}. Refined #{visible.refined.session_id}, prepared {visible.refined.draft.prepared_at}, read {visible.refined.read_at}. Source payload fingerprint matches the refinement's recorded lineage. These reads are not an atomic application-state snapshot.</p>
      <p className="text-xs text-warning">SQL text changes are not a semantic comparison. A bound may widen while other predicates narrow. Compiler acceptance and row caps do not prove matches, completeness, cost or safety. This review does not renew either draft's execution window or select any query.</p>
      <div className="flex flex-wrap gap-3 text-xs text-primary-300 underline"><a href={`/app/hunt?query_draft=${visible.source.session_id}`}>Open compared source draft #{visible.source.session_id}</a><a href={`/app/hunt?query_draft=${visible.refined.session_id}`}>Open compared refined draft #{visible.refined.session_id}</a></div>
      {visible.queries.map(query => <article key={query.position} className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
        <h5 className="text-sm font-semibold text-surface-100">Original query {query.position}: {query.edited ? 'analyst-edited' : 'not edited'}</h5>
        <p className="break-words text-xs text-surface-300">{query.changes.length ? `Changed fields: ${query.changes.join(', ')}.` : 'Displayed SQL, parameters and compiler fields match.'}</p>
        {query.timeBoundChanges.map(note => <p key={note} className="whitespace-pre-wrap break-words text-xs text-warning">{note}</p>)}
        <div className="grid min-w-0 gap-3 lg:grid-cols-2"><QueryPane label={`Recorded source #${visible.source.session_id}`} query={query.source} /><QueryPane label={`Saved refinement #${visible.refined.session_id}`} query={query.refined} /></div>
      </article>)}
      <button type="button" className={control} disabled={disabled || loading} onClick={download}>Download loaded draft source comparison JSON</button>
      <p className="text-xs text-surface-400">Contains both loaded drafts, hypotheses, SQL, parameters, fingerprints, read times and all retained query comparisons. No event results or extra reads. Previously omitted queries and unsaved edits are excluded. Keep private; copies have no application access controls. Downloading shares nothing with another person.</p>
      {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
