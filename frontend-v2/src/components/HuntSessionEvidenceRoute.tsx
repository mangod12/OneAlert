import { SavedHuntComparison } from './SavedHuntComparison';
import { HuntRunLink } from './HuntRunLink';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { HuntQueryEvidence } from './HuntQueryEvidence';
import { savedHuntEvidence } from '../utils/huntSessionEvidence';
import { saveHuntDownload } from '../utils/huntEvidence';
const control = 'max-w-full rounded border border-surface-600 px-3 py-2 text-left text-xs text-surface-200 disabled:opacity-40';
export function HuntSessionEvidenceRoute({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const values = params.getAll('session'), raw = values.length === 1 ? values[0] : '';
  const id = /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  const clear = () => setParams(current => { const next = new URLSearchParams(current); next.delete('session'); return next; }, { replace: true });
  return <>
    {values.length > 0 && id === null && <p role="alert" className="mb-4 text-sm text-danger">This hunt evidence link needs exactly one positive whole-number session ID. No saved session was opened. <button type="button" className="text-primary-300" onClick={clear}>Clear invalid hunt session link</button></p>}
    {id !== null && <Inspector key={id} sessionId={id} onClose={clear} />}
    {children}
  </>;
}
function Inspector({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const [record, setRecord] = useState<(ReturnType<typeof savedHuntEvidence> & { readAt: string }) | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(''), [downloadError, setDownloadError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setRecord(null); setLoading(true); setError(''); setCopied(false); setCopyError(''); setDownloadError('');
    void apiClient.get(`/hunt/${sessionId}`).then(response => {
      if (request !== requestId.current) return;
      setRecord({ ...savedHuntEvidence(response.data, sessionId), readAt: new Date().toISOString() });
    }).catch(err => { if (request === requestId.current) setError(getApiErrorMessage(err, 'Saved hunt evidence could not be loaded. It may be unavailable or outside your access.')); }).finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [sessionId, retry]);
  const copy = async () => {
    if (!record || loading) return; const request = requestId.current; setCopied(false); setCopyError('');
    try { const url = new URL('/app/hunt', window.location.origin); url.searchParams.set('session', String(sessionId)); await navigator.clipboard.writeText(url.toString()); if (requestId.current === request) setCopied(true); }
    catch { if (requestId.current === request) setCopyError('The hunt session link could not be copied. Loaded evidence is unchanged.'); }
  };
  const download = () => {
    if (!record || loading) return; setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ evidence_type: 'saved_hunt_session', loaded_at: record.readAt, exported_at: new Date().toISOString(), scope: 'Exact current saved hunt record, including original result_data. No queries rerun; retained rows are not confirmed threats. Missing metadata is not inferred. Not an immutable version.', session: record.session }, null, 2) + '\n', `hunt-${sessionId}-saved-record.json`, 'application/json'); }
    catch { setDownloadError('Saved hunt evidence could not be downloaded. The loaded record is unchanged.'); }
  };
  return <section aria-label={`Exact saved hunt session ${sessionId}`} className="oa-panel mb-6 min-w-0 space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Saved hunt session #{sessionId}</h2><button type="button" className={control} onClick={onClose}>Close saved hunt evidence</button></div>
    <p className="text-xs text-surface-400">Read-only saved evidence, independent of history pages and the hypothesis draft. No hunt or database query is rerun. Retained query rows are not confirmed threats. Refresh reads the current saved record, not an immutable version.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading exact saved hunt evidence...</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Retry saved hunt evidence</button></div>}
    {!loading && !error && record && <>
      <h3 className="whitespace-pre-wrap break-words text-base font-semibold text-surface-100 [overflow-wrap:anywhere]">{record.session.hypothesis}</h3>
      <p className="break-words text-xs text-surface-300">Recorded session status: {record.session.status} · {record.session.queries_run} recorded queries · {record.session.findings_count} recorded findings</p>
      <p className="break-words text-xs text-surface-400">Created {record.session.created_at} · Read {record.readAt}. Recorded finding counts may exceed retained rows. Paging and search below cover retained values only.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Refresh saved hunt evidence</button><button type="button" className={control} onClick={() => void copy()}>Copy exact saved hunt link</button><button type="button" className={control} onClick={download}>Download exact saved hunt JSON</button></div>
      <p className="text-xs text-surface-400">The link includes only this session ID, no query text, search filters or drafts. Recipients need their own access. Downloads contain the full saved record, including retained telemetry and query parameters. Review before sharing.</p>
      {copied && <p role="status" className="text-xs text-primary-300">Saved hunt link copied.</p>}{copyError && <p role="alert" className="text-xs text-danger">{copyError}</p>}{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
      <SavedHuntComparison key={`${sessionId}:${record.readAt}`} session={record.session} evidence={record.evidence} />
      <HuntRunLink runId={record.evidence.agent_run_id} />
      {record.evidence.execution_summary ? <p className="text-xs text-surface-300">Recorded execution summary: {record.evidence.execution_summary.completed} completed · {record.evidence.execution_summary.rejected} rejected · {record.evidence.execution_summary.failed} failed · {record.evidence.execution_summary.attempted} attempted · {record.evidence.execution_summary.skipped} skipped.</p> : <p className="text-xs text-warning">Detailed execution outcome was not recorded. A historical completion label does not prove that every query succeeded.</p>}
      {record.evidence.explanation && <p className="whitespace-pre-wrap break-words text-sm text-surface-300">{record.evidence.explanation}</p>}
      {record.evidence.error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-danger">{record.evidence.error}</p>}
      {!record.evidence.query_results?.length && <p className="text-sm text-surface-400">No query evidence was retained in this saved record. This does not establish zero results or a successful hunt.</p>}
      {record.evidence.query_results?.map((result, index) => <HuntQueryEvidence key={index} result={result} index={index} />)}
      {record.evidence.sigma_rule && <details><summary className="cursor-pointer text-xs text-primary-300">Saved Sigma output, not installed or tested here</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-surface-700 p-3 text-xs text-surface-300">{record.evidence.sigma_rule}</pre></details>}
    </>}
  </section>;
}
