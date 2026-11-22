import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload, type HuntEvidenceResult } from '../utils/huntEvidence';
import { auditReviewedHuntExecution, reviewedExecutionSourceId, reviewedHuntExecutionAuditJson, type ReviewedHuntExecutionAudit } from '../utils/huntReviewedExecutionAudit';
const control = 'min-h-10 max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function HuntReviewedExecutionAudit({ result, resultReadAt }: { result: HuntEvidenceResult; resultReadAt: string }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const [audit, setAudit] = useState<ReviewedHuntExecutionAudit | null>(null);
  const request = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  const close = () => { request.current++; inFlight.current = false; setOpen(false); setLoading(false); setAudit(null); setError(''); setDownloadError(''); };
  const read = async () => {
    if (inFlight.current) return;
    const version = ++request.current;
    inFlight.current = true; setOpen(true); setLoading(true); setAudit(null); setError(''); setDownloadError('');
    try {
      const id = reviewedExecutionSourceId(result);
      const response = await apiClient.get(`/hunt/query-drafts/${id}`);
      if (request.current === version) setAudit(auditReviewedHuntExecution(result, response.data));
    } catch (reason) { if (request.current === version) setError(getApiErrorMessage(reason, 'The exact reviewed draft could not be matched to this saved execution. No replacement source or query was requested.')); }
    finally { if (request.current === version) { inFlight.current = false; setLoading(false); } }
  };
  const visible = audit?.result === result ? audit : null;
  const download = () => {
    if (!visible || loading || inFlight.current) return;
    try { saveHuntDownload(reviewedHuntExecutionAuditJson(visible, resultReadAt, new Date().toISOString()), `hunt-${result.session_id}-reviewed-draft-audit.json`, 'application/json'); setDownloadError(''); }
    catch { setDownloadError('The loaded draft audit could not be downloaded. No extra read or execution was requested.'); }
  };
  if (!result.reviewed_draft) return null;
  return <section aria-label="Audit saved execution against its reviewed query draft" className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Audit the recorded query selection</h3>
    <p className="text-xs text-surface-400">Explicitly read only this execution receipt's recorded draft. Match its fingerprint and original selected query positions, SQL, parameters, and completed compiler contracts. No query rerun, AI call, source renewal or execution approval. This checks loaded records, not live event values or cryptographic integrity.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={loading} onClick={() => void read()}>{open ? 'Refresh exact reviewed-draft audit' : 'Audit exact reviewed draft'}</button>{open && <button type="button" className={control} onClick={close}>Close reviewed-draft audit</button>}</div>
    {loading && <p role="status" className="text-xs text-surface-300">Reading the exact recorded draft only...</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-warning">{error}</p>}
    {open && visible && <>
      <p className="break-words text-xs text-surface-300">Saved result #{result.session_id}, loaded {resultReadAt}. Recorded draft #{visible.source.session_id}, read {visible.source.read_at}. The source payload fingerprint matches the execution receipt. These reads are not atomic.</p>
      <div className="flex flex-wrap gap-3 text-xs text-primary-300 underline"><a href={`/app/hunt?query_draft=${visible.source.session_id}`}>Open audited source draft #{visible.source.session_id}</a><a href={`/app/hunt?session=${result.session_id}`}>Open audited saved result #{result.session_id}</a></div>
      <p className="text-xs text-surface-400">{visible.source.draft.queries.length - visible.queries.length} retained source queries were not selected for this execution. {visible.source.draft.omitted_query_count} generated queries were omitted from the source draft and are not recovered here. Draft execution availability now: {visible.source.can_execute ? 'available at its read time' : 'unavailable at its read time'}. This does not change the recorded execution.</p>
      {!visible.completeReceipt && <p className="text-xs text-warning">Source identity matched, but the interrupted run retained no complete query receipt. Selected SQL is shown from the draft only. No query completion, rows or zero findings can be established from this audit.</p>}
      {visible.queries.map(query => <article key={query.originalPosition} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
        <h4 className="text-sm font-semibold text-surface-100">Original draft query {query.originalPosition}</h4>
        <p className="text-xs text-surface-300">{query.result ? `Recorded outcome: ${query.result.outcome}. SQL, parameters and original position match the source draft.` : 'No complete execution receipt retained for this selected position.'}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-surface-300">{query.source.sql}</pre>
        <p className="text-xs font-semibold text-surface-300">Exact source parameters</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-surface-300">{JSON.stringify(query.source.params, null, 2)}</pre>
        {query.result?.outcome === 'completed' && <>
          <p className="text-xs text-surface-300">Completed receipt matches the source's applied selection, ordering, row cap and absolute bounds. {query.result.rows!.length} rows retained, not confirmed threats.</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-surface-300">{JSON.stringify({ execution: query.result.execution, time_window: query.result.time_window }, null, 2)}</pre>
        </>}
        {query.result && query.result.outcome !== 'completed' && <p className="text-xs text-warning">No completed applied contract or successful event search is inferred for this outcome. {query.result.error}</p>}
      </article>)}
      <button type="button" className={control} disabled={loading} onClick={download}>Download loaded reviewed-draft audit JSON</button>
      <p className="text-xs text-surface-400">Includes the loaded execution's retained telemetry, hypothesis, SQL, parameters, source draft and read times. Keep private; downloaded copies have no application access controls. No extra read, missing-row recovery or sharing occurs.</p>
      {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
