import { sourceProfileMetadata, type SourceProfile as Profile } from '../utils/sourceEvidenceMetadata';
import { SourceRecordedTimeline } from './SourceRecordedTimeline';
import { SourceGroupEvents, type SourceGroupSelection } from './SourceGroupEvents';
import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
const coverageFields = ['source_ip', 'dest_ip', 'hostname', 'username', 'domain'] as const;
const groupFields = ['severity', 'event_type', 'source_type', 'processed'] as const;
type Group = typeof groupFields[number];
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableTime = (value: unknown) => value === null || time(value);
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const display = (value: string | number | null) => value === null ? 'Not recorded' : value === '' ? '(empty text)' : String(value);
function validProfile(value: Profile, id: number) {
  if (!value || value.source?.id !== id || typeof value.source.name !== 'string' || typeof value.source.source_type !== 'string' || (value.source.status !== null && typeof value.source.status !== 'string') || (value.source.event_count !== null && !count(value.source.event_count)) || !nullableTime(value.source.last_event_at) || !time(value.source.created_at) || !count(value.retained_event_count) || !time(value.retrieved_at) || typeof value.scope !== 'string' || !value.nonempty_field_counts || !value.groups) return false;
  const total = value.retained_event_count;
  if (coverageFields.some(field => !count(value.nonempty_field_counts[field]) || value.nonempty_field_counts[field] > total)) return false;
  if (['first_observed_at', 'last_observed_at', 'first_created_at', 'last_created_at'].some(field => !nullableTime(value[field as keyof Profile]))) return false;
  if (total === 0 ? value.first_observed_at !== null || value.last_observed_at !== null || value.first_created_at !== null || value.last_created_at !== null : !time(value.first_observed_at) || !time(value.last_observed_at) || Date.parse(value.first_observed_at) > Date.parse(value.last_observed_at) || (value.first_created_at !== null && value.last_created_at !== null && Date.parse(value.first_created_at) > Date.parse(value.last_created_at))) return false;
  return groupFields.every(field => { const rows = value.groups[field]; return Array.isArray(rows) && rows.length <= 1000 && rows.every(row => row && (row.value === null || typeof row.value === 'string') && count(row.count) && row.count > 0) && new Set(rows.map(row => row.value)).size === rows.length && rows.reduce((sum, row) => sum + row.count, 0) === total; });
}
export function EventSourceEvidence({ sourceId }: { sourceId: number }) {
  const [selection, setSelection] = useState<(SourceGroupSelection & { readId: number }) | null>(null);
  const [data, setData] = useState<Profile | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const [group, setGroup] = useState<Group>('severity'), [query, setQuery] = useState(''), [page, setPage] = useState(1); const request = useRef(0), selectionReads = useRef(0);
  useEffect(() => { request.current++; setSelection(null); setData(null); setLoading(false); setError(''); setDownloadError(''); setPage(1); const invalidate = () => { request.current++; }; return invalidate; }, [sourceId]);
  const load = async () => {
    const read = ++request.current; setSelection(null); setData(null); setLoading(true); setError(''); setDownloadError(''); setPage(1);
    try { const { data: value } = await apiClient.get<Profile>(`/events/sources/${sourceId}/recorded-evidence`); if (read !== request.current) return; if (!validProfile(value, sourceId)) throw Error('Recorded source evidence did not match this source and complete retained-event totals. Read again before relying on it.'); setData(value); }
    catch (err) { if (read === request.current) setError(getApiErrorMessage(err, 'Recorded source evidence unavailable. No sensor health or absence of activity is inferred.')); }
    finally { if (read === request.current) setLoading(false); }
  };
  const rows = data ? data.groups[group].filter(row => !query.trim() || display(row.value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [], current = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const download = () => {
    if (!data) return; setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_source_recorded_evidence_v1', exported_at: new Date().toISOString(), ...sourceProfileMetadata(data), download_scope: 'Complete loaded source profile and all recorded-label groups, independent of display filters. No event payloads or source configuration. Source names may be sensitive; downloaded copies have no application access controls. No extra read or message.' }, null, 2) + '\n', `source-${sourceId}-recorded-evidence.json`, 'application/json'); }
    catch { setDownloadError('The loaded source profile could not be downloaded. No records changed.'); }
  };
  return <section aria-label="Recorded source evidence profile" className="oa-panel space-y-3 p-4">
    <h2 className="font-semibold text-surface-100">Inspect this source's retained event evidence</h2><p className="text-xs text-surface-400">Explicitly read source #{sourceId} and all currently retained owned events with this exact source ID. This profile ignores the event list's other filters. Recorded source status, counter and last-event metadata are not live connectivity, freshness or detection coverage. No scan, AI call or state change.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={loading} className={control} onClick={() => void load()}>{loading ? 'Reading source evidence...' : 'Read recorded source profile'}</button><button type="button" className={control} onClick={() => { request.current++; setSelection(null); setData(null); setLoading(false); setError(''); setDownloadError(''); }}>Clear source profile</button></div>
    {error && <p role="alert" className="text-xs text-danger">{error} No absence of activity or sensor health is inferred.</p>}
    {data && <>
      <h3 className="whitespace-pre-wrap break-words font-semibold text-surface-100">Source #{data.source.id}: {data.source.name}</h3><p className="break-words text-xs text-surface-400">Source record type {display(data.source.source_type)} · Stored status {display(data.source.status)} · Created {data.source.created_at} · Read {data.retrieved_at}</p>
      <div className="grid gap-3 text-sm text-surface-200 sm:grid-cols-2"><p>Retained owned events: {data.retained_event_count}</p><p>Source's recorded counter: {display(data.source.event_count)}</p></div>
      {data.source.event_count !== null && data.source.event_count !== data.retained_event_count && <p className="text-xs text-warning">The source's recorded counter differs from the retained owned event count. They describe separate stored data; this is not proof of data loss, duplicates or sensor failure.</p>}
      <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2">{([['First saved observation timestamp', data.first_observed_at], ['Last saved observation timestamp', data.last_observed_at], ['First saved event created timestamp', data.first_created_at], ['Last saved event created timestamp', data.last_created_at], ['Source record last-event metadata', data.source.last_event_at]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-surface-400">{label}</dt><dd className="break-words text-surface-200">{display(value)}</dd></div>)}</dl>
      <p className="text-xs text-surface-400">Observation timestamps may be old or future-dated. Created timestamps are insertion metadata, not verified arrival. These separate current reads are not an atomic snapshot or complete ingestion history.</p>
      <SourceRecordedTimeline key={`${sourceId}:${data.retrieved_at}`} sourceId={sourceId} lastObservedAt={data.last_observed_at} />
      <div className="space-y-2"><h3 className="text-sm font-semibold text-surface-100">Recorded field coverage</h3><p className="text-xs text-surface-400">Nonempty text after database space trimming, not valid addresses, identities or evidence quality. Fields overlap; do not add these counts.</p><dl className="grid gap-3 text-xs text-surface-200 sm:grid-cols-3">{coverageFields.map(field => <div key={field}><dt className="text-surface-400">{field.replaceAll('_', ' ')}</dt><dd>{data.nonempty_field_counts[field]} of {data.retained_event_count} retained events</dd></div>)}</dl></div>
      <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-surface-300">Recorded label group<select aria-label="Source profile label group" className={`${control} mt-1 block`} value={group} onChange={event => { setGroup(event.target.value as Group); setPage(1); }}>{groupFields.map(field => <option key={field} value={field}>{field.replaceAll('_', ' ')}</option>)}</select></label><label className="min-w-0 basis-full flex-1 text-xs text-surface-300 sm:basis-64">Find loaded labels<input aria-label="Search source profile groups" className={`${control} mt-1 block w-full`} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label></div>
      <p className="text-xs text-surface-400">All recorded labels are retained, including unfamiliar, empty or missing values. Search and paging affect only this loaded display, not profile totals or download.</p>
      {!rows.length && <p className="text-xs text-surface-300">{data.retained_event_count === 0 ? 'No owned retained events were found for this source in this read. This is not proof no telemetry arrived.' : 'No loaded labels match this display search.'}</p>}
      <ul aria-label="Source profile recorded groups" className="space-y-2">{rows.slice((current - 1) * 8, current * 8).map(row => <li key={row.value === null ? 'null' : `string:${row.value}`} className="flex min-w-0 flex-wrap justify-between gap-3 rounded border border-surface-700 p-3 text-xs text-surface-300"><span className="whitespace-pre-wrap break-all">{display(row.value)}</span><div className="flex shrink-0 flex-col items-end gap-2"><span>{row.count} {row.count === 1 ? 'event' : 'events'}</span><button type="button" className={control} onClick={() => setSelection({ group, value: row.value, profileCount: row.count, profileReadAt: data.retrieved_at, readId: ++selectionReads.current })}>Read this exact label's events</button></div></li>)}</ul>
      <nav aria-label="Source profile group pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" className={control} disabled={current === 1} onClick={() => setPage(current - 1)}>Previous source labels</button><span>Page {current} of {Math.max(1, Math.ceil(rows.length / 8))} · {rows.length} {rows.length === 1 ? 'label' : 'labels'}</span><button type="button" className={control} disabled={current * 8 >= rows.length} onClick={() => setPage(current + 1)}>More source labels</button></nav>
      {selection && <SourceGroupEvents key={`${sourceId}:${selection.group}:${JSON.stringify(selection.value)}:${selection.profileReadAt}:${selection.readId}`} sourceId={sourceId} selection={selection} onClose={() => setSelection(null)} />}
      <button type="button" className={control} onClick={download}>Download loaded source profile JSON</button><p className="text-xs text-surface-400">Complete loaded profile and all groups, not event payloads, source configuration or original upload bytes. Source names may be sensitive. Keep private; downloaded copies have no application access controls. No extra read or message.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}
