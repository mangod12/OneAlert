import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
interface Value { kind: 'text' | 'integer' | 'null'; text: string | null; shortened: boolean }
interface Field { name: string; retained: Value; current: Value; equal: boolean }
interface Evidence { session_id: number; query_number: number; row_number: number; event_id: number; fingerprint: string; current_available: boolean; field_count: number; fields: Field[]; text_limit: number; retrieved_at: string; scope: string }
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const valueValid = (value: Value) => value && typeof value.shortened === 'boolean' && (value.kind === 'null' ? value.text === null && !value.shortened : value.kind === 'integer' ? typeof value.text === 'string' && value.text.length <= 20 && /^-?(0|[1-9]\d*)$/.test(value.text) && !value.shortened : value.kind === 'text' && typeof value.text === 'string' && Array.from(value.text).length <= 1000);
const text = (value: Value) => value.kind === 'null' ? '(null)' : value.text === '' ? '(empty text)' : value.text;
export function RetainedHuntCurrentEvent({ sessionId, queryNumber, rowNumber, eventId, fingerprint, columns, onClose, onRefreshSaved }: { sessionId: number; queryNumber: number; rowNumber: number; eventId: number; fingerprint: string; columns: string[]; onClose: () => void; onRefreshSaved: () => void }) {
  const [data, setData] = useState<Evidence | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0), [changed, setChanged] = useState(false), [downloadError, setDownloadError] = useState('');
  const revision = useRef(0), columnsKey = JSON.stringify(columns);
  useEffect(() => {
    const version = ++revision.current; setData(null); setError(''); setChanged(false); setDownloadError(''); setLoading(true);
    const selected = JSON.parse(columnsKey) as string[];
    void apiClient.get<Evidence>(`/hunt/${sessionId}/queries/${queryNumber}/retained-rows/${rowNumber}/current-evidence`, { params: { fingerprint, expected_event_id: eventId } }).then(({ data: value }) => {
      if (version !== revision.current) return;
      if (!value || value.session_id !== sessionId || value.query_number !== queryNumber || value.row_number !== rowNumber || value.event_id !== eventId || value.fingerprint !== fingerprint || typeof value.current_available !== 'boolean' || value.field_count !== selected.length || value.text_limit !== 1000 || typeof value.retrieved_at !== 'string' || !Number.isFinite(Date.parse(value.retrieved_at)) || typeof value.scope !== 'string' || !value.scope || !Array.isArray(value.fields) || value.fields.length !== (value.current_available ? selected.length : 0) || value.fields.some((field, index) => !field || field.name !== selected[index] || !valueValid(field.retained) || !valueValid(field.current) || typeof field.equal !== 'boolean' || (field.equal && (field.retained.kind !== field.current.kind || field.retained.text !== field.current.text)) || (!field.equal && !field.retained.shortened && !field.current.shortened && field.retained.kind === field.current.kind && field.retained.text === field.current.text))) throw Error('Current event comparison did not match this exact loaded saved row and complete field set. Refresh saved evidence before relying on it.');
      setData(value);
    }).catch(reason => { if (version === revision.current) { setError(getApiErrorMessage(reason, 'Current retained-row comparison unavailable.')); setChanged(reason?.response?.status === 409); } }).finally(() => { if (version === revision.current) setLoading(false); });
    const invalidate = () => { revision.current++; }; return invalidate;
  }, [sessionId, queryNumber, rowNumber, eventId, fingerprint, columnsKey, retry]);
  const current = data && data.session_id === sessionId && data.query_number === queryNumber && data.row_number === rowNumber && data.event_id === eventId && data.fingerprint === fingerprint;
  const download = () => {
    if (!data || !current || loading || error) return;
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_hunt_retained_current_event_v1', exported_at: new Date().toISOString(), ...data, download_scope: 'One loaded saved-row/current-event comparison. Selected metadata may be sensitive. Keep private; downloaded copies have no application access controls. No extra read or sharing.' }, null, 2) + '\n', `hunt-${sessionId}-query-${queryNumber}-row-${rowNumber}-current-event.json`, 'application/json'); setDownloadError(''); }
    catch { setDownloadError('The loaded row comparison could not be downloaded. No records changed.'); }
  };
  return <section aria-label="Retained hunt row and current event comparison" className="my-3 space-y-3 rounded border border-primary-700 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="text-sm font-semibold text-surface-100">Saved query {queryNumber}, retained row {rowNumber} · Event #{eventId}</h4><button type="button" className={control} onClick={onClose}>Close current event comparison</button></div>
    <p className="text-xs text-surface-400">Reads the current owned event with the retained ID, not the original hunt query. Compares only the saved selected field values, not an entire record or whether it still matches the query. Reads are not an atomic or immutable snapshot. A difference does not prove malicious activity; unavailable current evidence does not prove deletion.</p>
    {loading && <p role="status" className="text-xs text-surface-300">Comparing the exact retained row with current selected event fields...</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {changed ? <button type="button" className={control} onClick={onRefreshSaved}>Refresh saved hunt before comparing again</button> : <button type="button" className={control} disabled={loading} onClick={() => setRetry(v => v + 1)}>Read current event comparison again</button>}
    {!loading && !error && current && data && <>
      <p className="break-words text-xs text-surface-400">Current field read {data.retrieved_at}. Text displays at most 1,000 Unicode characters per value; equality uses complete selected serialized values before shortening. Integer values are exact decimal text, including large values.</p>
      {!data.current_available ? <p className="text-xs text-warning">The current event is unavailable or outside your access. No deletion, absence of activity or original hunt outcome is inferred.</p> : <>
        <p role="status" className="text-sm text-surface-200">{data.fields.filter(field => !field.equal).length} of {data.field_count} selected serialized fields differ.</p>
        <a className="inline-block text-xs text-primary-300 underline" href={`/app/events/${eventId}`}>Open exact current event #{eventId}</a>
        <dl className="space-y-3">{data.fields.map(field => <div key={field.name} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs"><dt className="break-words font-semibold text-surface-100">{field.name} · {field.equal ? 'Same selected value' : 'Different selected value'}</dt><dd className="grid gap-3 sm:grid-cols-2">{([['Retained', field.retained], ['Current', field.current]] as const).map(([label, value]) => <div key={label} className="min-w-0"><p className="text-surface-400">{label} · {value.kind}{value.shortened ? ' · shortened display' : ''}</p><pre className="whitespace-pre-wrap break-all text-surface-300">{text(value)}</pre></div>)}</dd></div>)}</dl>
      </>}
      <button type="button" className={control} onClick={download}>Download loaded retained/current row comparison JSON</button><p className="text-xs text-surface-400">Includes only this loaded comparison, including shortened-value markers. Selected addresses or identifiers may be sensitive. Keep private. No extra read or message.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
