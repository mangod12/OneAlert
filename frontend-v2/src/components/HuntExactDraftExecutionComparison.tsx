import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { parseHuntQueryDraft, type HuntQueryDraft } from '../utils/huntQueryDraft';
import { auditExactDraftExecutionPair, compareExactDraftExecutionQuery, exactDraftExecutionComparisonJson, type ExactDraftExecutionPair } from '../utils/exactDraftExecutionComparison';
import { saveHuntDownload } from '../utils/huntEvidence';
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
type LoadedPair = { pair: ExactDraftExecutionPair; readTimes: { left: string; right: string } };
export function HuntExactDraftExecutionComparison({ source, disabled = false }: { source: HuntQueryDraft; disabled?: boolean }) {
  return <Comparison key={`${source.session_id}:${source.fingerprint}:${source.read_at}`} source={source} disabled={disabled} />;
}
function Comparison({ source, disabled }: { source: HuntQueryDraft; disabled: boolean }) {
  const [leftId, setLeftId] = useState(''), [rightId, setRightId] = useState('');
  const [loaded, setLoaded] = useState<LoadedPair | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const [position, setPosition] = useState(0), [rowSet, setRowSet] = useState<'onlyA' | 'onlyB' | 'shared'>('onlyA'), [page, setPage] = useState(1);
  const revision = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { revision.current++; }, []);
  const clear = () => { revision.current++; inFlight.current = false; setLoaded(null); setLoading(false); setError(''); setDownloadError(''); setPosition(0); setPage(1); setRowSet('onlyA'); };
  const read = async () => {
    if (disabled || inFlight.current) return;
    clear(); const request = ++revision.current;
    try {
      const checked = parseHuntQueryDraft(source), values = [leftId.trim(), rightId.trim()];
      const ids = values.map(value => /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : 0);
      if (ids.some(id => id < 1 || id > 2147483647 || id === checked.session_id) || ids[0] === ids[1]) throw Error('Enter two distinct positive saved execution IDs, at most 2147483647, neither the source draft itself.');
      inFlight.current = true; setLoading(true);
      const [left, right] = await Promise.all(ids.map(async id => { const response = await apiClient.get(`/hunt/${id}`); return { value: response.data, readAt: new Date().toISOString() }; }));
      if (request !== revision.current) return;
      const pair = auditExactDraftExecutionPair(checked, left.value, ids[0], right.value, ids[1]);
      setLoaded({ pair, readTimes: { left: left.readAt, right: right.readAt } }); setPosition(pair.completedPositions[0]);
    } catch (reason) { if (request === revision.current) setError(getApiErrorMessage(reason, 'The exact saved executions could not both be matched to this loaded draft. No replacement, event query or execution retry was requested.')); }
    finally { if (request === revision.current) { inFlight.current = false; setLoading(false); } }
  };
  let comparison: ReturnType<typeof compareExactDraftExecutionQuery> | null = null, comparisonError = '';
  if (loaded) { try { comparison = compareExactDraftExecutionQuery(loaded.pair, position); } catch { comparisonError = 'The loaded completed receipts no longer match this source and original position. Read both exact records again. No rows were inferred.'; } }
  const rows = comparison?.rows[rowSet] ?? [], pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);
  const download = () => {
    if (!loaded || !comparison || loading || disabled) return;
    try { saveHuntDownload(exactDraftExecutionComparisonJson(loaded.pair, position, loaded.readTimes, new Date().toISOString()), `hunt-draft-${source.session_id}-executions-${loaded.pair.left.session.id}-vs-${loaded.pair.right.session.id}-query-${position}.json`, 'application/json'); setDownloadError(''); }
    catch { setDownloadError('The selected loaded comparison could not be downloaded. No extra read or event execution was requested.'); }
  };
  return <section aria-label="Compare executions of this exact query draft" className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
    <h4 className="text-sm font-semibold text-surface-100">Compare completed executions of this draft</h4>
    <p className="text-xs text-surface-400">Choose two exact saved execution IDs, for example from the receipt list above. Read both saved records only on request. Match their source fingerprint, original selected positions, SQL, parameters and completed contracts to this loaded draft. No event SELECT, AI call, source renewal or execution retry.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void read(); }}>
      <label className="min-w-0 text-xs text-surface-300">Saved execution A<input aria-label="Exact-draft saved execution A ID" inputMode="numeric" maxLength={10} value={leftId} disabled={disabled} onChange={event => { clear(); setLeftId(event.target.value); }} className={`${control} mt-1 block w-40`} /></label>
      <label className="min-w-0 text-xs text-surface-300">Saved execution B<input aria-label="Exact-draft saved execution B ID" inputMode="numeric" maxLength={10} value={rightId} disabled={disabled} onChange={event => { clear(); setRightId(event.target.value); }} className={`${control} mt-1 block w-40`} /></label>
      <button type="submit" className={control} disabled={loading || disabled}>Read exact saved executions for comparison</button>
      {(loaded || loading || error) && <button type="button" className={control} onClick={clear}>Close exact execution comparison</button>}
    </form>
    {loading && <p role="status" className="text-xs text-surface-300">Reading both exact saved execution records. No query is rerun...</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-warning">{error}</p>}
    {comparisonError && <p role="alert" className="text-xs text-warning">{comparisonError}</p>}
    {loaded && comparison && <>
      <p className="break-words text-xs text-surface-300">Loaded draft #{source.session_id}, read {source.read_at}. A #{loaded.pair.left.session.id}, read {loaded.readTimes.left}. B #{loaded.pair.right.session.id}, read {loaded.readTimes.right}.</p>
      <div className="flex flex-wrap gap-3 text-xs text-primary-300 underline"><a href={`/app/hunt?session=${loaded.pair.left.session.id}`}>Inspect exact execution A #{loaded.pair.left.session.id}</a><a href={`/app/hunt?session=${loaded.pair.right.session.id}`}>Inspect exact execution B #{loaded.pair.right.session.id}</a></div>
      <p className="text-xs text-warning">Both selected completed receipts match the loaded source contract, not its latest live server version or cryptographic integrity. Reads are not atomic or immutable. Differences are not confirmed threats or a measured change in security posture. Row caps, ordering and changing telemetry can affect retained sets.</p>
      <label className="block text-xs text-surface-300">Original query completed in both<select aria-label="Common completed original draft query" value={position} disabled={disabled} onChange={event => { setPosition(Number(event.target.value)); setPage(1); setDownloadError(''); }} className={`${control} mt-1 block`}>{loaded.pair.completedPositions.map(number => <option key={number} value={number}>Original query {number}</option>)}</select></label>
      <p className="text-xs text-surface-300">Only common completed original positions are comparable here. Failed, rejected, unselected and interrupted queries are not empty successful results.</p>
      <details className="text-xs text-surface-300"><summary className="cursor-pointer text-primary-300">Selected matched source SQL, parameters and applied contract</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-950 p-2">{JSON.stringify({ original_position: position, sql: comparison.source.sql, params: comparison.source.params, execution: comparison.source.execution, time_window: comparison.source.time_window }, null, 2)}</pre></details>
      <p className="text-xs text-surface-300">A: {comparison.left.rows!.length} retained rows. B: {comparison.right.rows!.length} retained rows. {comparison.rows.shared.length} shared exact rows; {comparison.rows.onlyA.length} only in A; {comparison.rows.onlyB.length} only in B. Duplicate rows count separately. Object field order is ignored; array order and missing versus null values are preserved. No unretained rows are recovered.</p>
      <label className="block text-xs text-surface-300">Retained row set<select aria-label="Exact execution comparison row set" value={rowSet} disabled={disabled} onChange={event => { setRowSet(event.target.value as typeof rowSet); setPage(1); setDownloadError(''); }} className={`${control} mt-1 block`}><option value="onlyA">Only in A</option><option value="onlyB">Only in B</option><option value="shared">Shared exact rows</option></select></label>
      {!rows.length && <p className="text-xs text-surface-400">No retained rows in this selected set. This does not establish no threats or no database change.</p>}
      <ol aria-label="Exact draft execution compared rows" className="space-y-2">{rows.slice((currentPage - 1) * 10, currentPage * 10).map((row, index) => <li key={index}><pre className="whitespace-pre-wrap break-all rounded border border-surface-700 p-2 text-xs text-surface-300">{JSON.stringify(row, null, 2)}</pre></li>)}</ol>
      <nav aria-label="Exact execution compared row pages" className="flex flex-wrap items-center gap-2"><button type="button" className={control} disabled={disabled || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous exact compared rows</button><span className="text-xs text-surface-400">Page {currentPage} of {pages}</span><button type="button" className={control} disabled={disabled || currentPage >= pages} onClick={() => setPage(currentPage + 1)}>More exact compared rows</button></nav>
      <button type="button" className={control} disabled={disabled || loading} onClick={download}>Download selected exact execution comparison JSON</button>
      <p className="text-xs text-surface-400">Includes the selected original query's SQL, parameters, retained telemetry from A and B, and all three loaded row sets across local pages. Other queries and whole saved sessions are excluded. Keep private; downloaded copies have no application access controls. No extra read or sharing.</p>
      {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
