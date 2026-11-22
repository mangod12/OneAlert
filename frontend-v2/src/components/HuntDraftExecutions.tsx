import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
import { parseHuntQueryDraft, type HuntQueryDraft } from '../utils/huntQueryDraft';
import { draftExecutionPageJson, parseDraftExecutionPage, type DraftExecutionPage } from '../utils/huntDraftExecutions';
const control = 'min-h-10 max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function HuntDraftExecutions({ source, disabled = false }: { source: HuntQueryDraft; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const [page, setPage] = useState<DraftExecutionPage | null>(null);
  const request = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  const close = () => { request.current++; inFlight.current = false; setOpen(false); setLoading(false); setPage(null); setError(''); setDownloadError(''); };
  const read = async (offset = 0) => {
    if (disabled || inFlight.current) return;
    const version = ++request.current; inFlight.current = true; setOpen(true); setLoading(true); setPage(null); setError(''); setDownloadError('');
    try {
      const checked = parseHuntQueryDraft(source);
      const response = await apiClient.get(`/hunt/query-drafts/${checked.session_id}/executions`, { params: { fingerprint: checked.fingerprint, offset, limit: 10 } });
      if (request.current === version) setPage(parseDraftExecutionPage(response.data, checked, offset, 10));
    } catch (reason) { if (request.current === version) setError(getApiErrorMessage(reason, 'Saved receipts could not be read for this exact draft. Close this list and reopen the exact source draft if it changed. No fallback or retry of event execution occurred.')); }
    finally { if (request.current === version) { inFlight.current = false; setLoading(false); } }
  };
  const visible = page?.source_session_id === source.session_id && page.source_fingerprint === source.fingerprint ? page : null;
  const download = () => {
    if (!visible || loading || disabled) return;
    try { saveHuntDownload(draftExecutionPageJson(visible, source, new Date().toISOString()), `hunt-draft-${source.session_id}-execution-receipts-offset-${visible.offset}.json`, 'application/json'); setDownloadError(''); }
    catch { setDownloadError('The loaded receipt page could not be downloaded. No extra read or event execution was requested.'); }
  };
  return <section aria-label="Saved execution receipts for this exact query draft" className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
    <h4 className="text-sm font-semibold text-surface-100">Inspect saved execution receipts</h4>
    <p className="text-xs text-surface-400">Read saved owner records claiming this exact draft ID and fingerprint. Useful before retrying an uncertain execution. This reads receipt metadata only, not event rows, SQL or parameters. No AI call, event SELECT, source renewal or execution retry.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={loading || disabled} onClick={() => void read()}>{open ? 'Refresh saved execution receipts' : 'Read saved execution receipts'}</button>{open && <button type="button" className={control} onClick={close}>Close execution receipts</button>}</div>
    {loading && <p role="status" className="text-xs text-surface-300">Reading one page of exact-source saved receipt metadata...</p>}
    {error && <div className="space-y-2"><p role="alert" className="whitespace-pre-wrap break-words text-xs text-warning">{error}</p><a className="text-xs text-primary-300 underline" href={`/app/hunt?query_draft=${source.session_id}`}>Reopen exact source draft #{source.session_id}</a></div>}
    {open && visible && <>
      <p className="break-words text-xs text-surface-300">Draft #{visible.source_session_id}. Read {visible.read_at}. Records on this page: {visible.executions.length}. Matching saved records at this read: {visible.total}. Offset {visible.offset}; newest saved record IDs first.</p>
      <p className="text-xs text-warning">Missing receipts or an empty page do not prove no database query ran. A supported receipt checks selection metadata, not full contracts or successful execution. Statuses and counts are saved metadata, not confirmed threats. Inspect exact saved results and their audits before retrying. Pages are not an atomic or live snapshot.</p>
      {!visible.executions.length && <p className="text-xs text-surface-300">No matching saved receipt records on this page. Refresh the first page to check again; no execution outcome is inferred.</p>}
      {visible.executions.map(row => <article key={row.session_id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300">
        <h5 className="text-sm font-semibold text-surface-100">Saved record #{row.session_id}</h5>
        <p className="break-words">Recorded status: {row.status}. Created: {row.created_at ?? 'not recorded'}.</p>
        {row.receipt_supported ? <p>Supported selection receipt: original draft queries {row.query_numbers!.join(', ')}. Full query-result contracts are not checked by this list.</p> : <p className="text-warning">Unsupported selection receipt. No selected-query relationship or successful execution is established here.</p>}
        <p>Recorded queries attempted: {row.recorded_queries_run ?? 'not recorded'}. Recorded query-row count: {row.recorded_row_count ?? 'not recorded'}. Missing or interrupted results can still be incomplete.</p>
        <div className="flex flex-wrap gap-3 text-primary-300 underline"><a href={`/app/hunt?session=${row.session_id}`}>Inspect exact saved record #{row.session_id}</a>{row.agent_run_id !== null && <a href={`/app/audit-log?run=${row.agent_run_id}`}>Inspect recorded hunt run #{row.agent_run_id}</a>}</div>
        {row.agent_run_id === null && <p className="text-surface-400">No supported owned hunt-run link was returned for this record.</p>}
      </article>)}
      <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={disabled || loading || visible.offset === 0} onClick={() => void read(Math.max(0, visible.offset - visible.limit))}>Previous receipt page</button><button type="button" className={control} disabled={disabled || loading || visible.offset >= 10000 || visible.offset + visible.limit >= visible.total} onClick={() => void read(visible.offset + visible.limit)}>Next receipt page</button></div>
      {visible.offset >= 10000 && visible.offset + visible.executions.length < visible.total && <p className="text-xs text-warning">This view's 10,000-offset review boundary was reached. Additional matching records are not loaded.</p>}
      <button type="button" className={control} disabled={disabled || loading} onClick={download}>Download loaded receipt page JSON</button>
      <p className="text-xs text-surface-400">Exports only this metadata page, not all receipts or event evidence. IDs, statuses, counts and selected positions may be sensitive. Keep private; copies have no application access controls. No extra read or sharing.</p>
      {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
