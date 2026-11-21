import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
import { comparedValue, eventComparisonFields, validComparedSnapshot, type ComparedSnapshot } from '../utils/eventComparison';
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const scope = 'Two separately read current owned event records, not an atomic or historical snapshot. Baseline/comparison order is chosen, not chronology or causality. Literal normalized field equality only, not semantic payload equality, related activity, common identity, incident or compromise. Raw payloads and linked source metadata are not compared or exported. Missing values are not zero, empty text or evidence of no activity.';
export function EventFieldComparison({ eventId }: { eventId: number }) {
  const [target, setTarget] = useState(''), [applied, setApplied] = useState<number | null>(null), [pair, setPair] = useState<ComparedSnapshot[] | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const [query, setQuery] = useState(''), [changedOnly, setChangedOnly] = useState(true), [page, setPage] = useState(1);
  const request = useRef(0), targetId = /^[1-9][0-9]*$/.test(target.trim()) && Number.isSafeInteger(Number(target)) ? Number(target) : null;
  const valid = targetId !== null && targetId !== eventId, dirty = applied !== null && targetId !== applied;
  useEffect(() => { request.current++; setPair(null); setApplied(null); setTarget(''); setLoading(false); setError(''); setDownloadError(''); const invalidate = () => { request.current++; }; return invalidate; }, [eventId]);
  const load = async () => {
    if (!valid || targetId === null) return;
    const read = ++request.current, ids = [eventId, targetId]; setApplied(targetId); setPair(null); setError(''); setDownloadError(''); setLoading(true); setPage(1);
    try {
      const results = await Promise.all(ids.map(id => apiClient.get(`/events/${id}/evidence`)));
      if (read !== request.current) return;
      if (!results.every(({ data }, index) => validComparedSnapshot(data, ids[index]))) throw Error('Event evidence did not match both requested records and complete compared fields. Read again before relying on the comparison.');
      setPair(results.map(({ data }) => ({ event: { id: data.event.id, ...Object.fromEntries(eventComparisonFields.map(field => [field, data.event[field]])) }, retrieved_at: data.retrieved_at })));
    } catch (err) { if (read === request.current) setError(getApiErrorMessage(err, 'Event comparison unavailable. No equality or absence of activity is inferred.')); }
    finally { if (read === request.current) setLoading(false); }
  };
  const differences = pair ? eventComparisonFields.filter(field => pair[0].event[field] !== pair[1].event[field]) : [];
  const needle = query.trim().toLocaleLowerCase(), rows = pair ? (changedOnly ? differences : eventComparisonFields).filter(field => !needle || [field.replaceAll('_', ' '), ...pair.map(item => comparedValue(item.event[field]))].some(value => value.toLocaleLowerCase().includes(needle))) : [];
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const download = () => {
    if (!pair || dirty) return;
    setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_event_field_comparison_v1', exported_at: new Date().toISOString(), scope, baseline: pair[0], comparison: pair[1], compared_fields: eventComparisonFields, differing_fields: differences, download_scope: 'All compared normalized fields from this loaded pair, independent of display filters. No raw payloads or linked source metadata. Potentially sensitive addresses, names and URLs. Downloaded copies have no application access controls. No new read or message.' }, null, 2) + '\n', `event-${eventId}-versus-${applied}-recorded-fields.json`, 'application/json'); }
    catch { setDownloadError('The loaded event comparison could not be downloaded. No records changed.'); }
  };
  return <section aria-label="Compare recorded event fields" className="oa-panel space-y-3 p-4">
    <h2 className="font-semibold text-surface-100">Compare two saved event records</h2><p className="text-xs text-surface-400">{scope} No scan, AI call or state change.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void load(); }}><label className="min-w-0 basis-full flex-1 text-xs text-surface-300 sm:basis-64">Comparison event ID<input aria-label="Comparison event ID" className={`${control} mt-1 block w-full`} inputMode="numeric" value={target} onChange={event => setTarget(event.target.value)} /></label><button type="submit" disabled={!valid || loading} className={control}>{loading ? 'Reading event pair...' : 'Read both event records'}</button><button type="button" className={control} onClick={() => { request.current++; setPair(null); setApplied(null); setLoading(false); setError(''); setDownloadError(''); }}>Clear event comparison</button></form>
    <p className="text-xs text-surface-400">Baseline is current event #{eventId}. Enter a different exact event ID. Loading rereads both records, not the evidence already shown above.</p>
    {target && !valid && <p className="text-xs text-warning">Choose a different positive whole event ID, without a URL, sign or decimal.</p>}{dirty && <p role="status" className="text-xs text-warning">The comparison ID draft is not applied. Loaded results still use event #{applied}; read both records or clear before downloading.</p>}
    {error && <p role="alert" className="text-xs text-danger">{error} No equality or absence of activity is inferred.</p>}
    {pair && <>
      <p role="status" className="text-sm text-surface-200">{differences.length} of {eventComparisonFields.length} compared fields differ.</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{pair.map((item, index) => <div key={item.event.id} className="min-w-0 text-xs text-surface-300"><p className="break-words">{index === 0 ? 'Baseline' : 'Comparison'} #{item.event.id} · Read {item.retrieved_at}</p><a className="inline-block text-primary-300 underline" href={`/app/events/${item.event.id}`}>Open original event #{item.event.id}</a></div>)}</div>
      <div className="flex flex-wrap items-center gap-3"><label className="min-w-0 basis-full flex-1 text-xs text-surface-300 sm:basis-64">Find compared fields<input aria-label="Search event comparison fields" className={`${control} mt-1 block w-full`} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={changedOnly} onChange={event => { setChangedOnly(event.target.checked); setPage(1); }} />Differing event fields only</label></div>
      {!rows.length && <p className="text-xs text-surface-300">{!differences.length && changedOnly && !needle ? 'No differences in the compared recorded fields. This does not establish equivalent events or no related activity.' : 'No compared fields match these display filters.'}</p>}
      <dl className="space-y-3">{rows.slice((current - 1) * 8, current * 8).map(field => <div key={field} className="min-w-0 rounded border border-surface-700 p-3"><dt className="mb-2 text-xs font-semibold text-surface-100">{field.replaceAll('_', ' ')} · {pair[0].event[field] === pair[1].event[field] ? 'Same recorded value' : 'Different recorded values'}</dt><dd className="grid min-w-0 gap-3 text-xs text-surface-300 sm:grid-cols-2">{pair.map((item, index) => <div key={item.event.id} className="min-w-0"><p className="mb-1 text-surface-400">{index === 0 ? 'Baseline' : 'Comparison'} #{item.event.id}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{comparedValue(item.event[field])}</p></div>)}</dd></div>)}</dl>
      <nav aria-label="Event comparison field pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" disabled={current === 1} className={control} onClick={() => setPage(current - 1)}>Previous event fields</button><span>Page {current} of {Math.max(1, Math.ceil(rows.length / 8))} · {rows.length} matching fields</span><button type="button" disabled={current * 8 >= rows.length} className={control} onClick={() => setPage(current + 1)}>More event fields</button></nav>
      <button type="button" disabled={dirty} className={control} onClick={download}>Download loaded event field comparison JSON</button><p className="text-xs text-surface-400">Includes all {eventComparisonFields.length} compared fields from both loaded records, not just these display filters. Exact byte-counter text is preserved. No raw payloads or linked source metadata. Names, addresses and URLs can be sensitive. Keep private; downloaded copies have no application access controls. No new read or message.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
