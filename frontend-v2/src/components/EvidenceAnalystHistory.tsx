import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
interface Props { kind: 'alert' | 'event'; recordId: number }
interface Row { note_id: number; case_id: number; case_title: string; case_title_truncated: boolean; case_status: string | null; case_severity: string | null; note_timestamp: string | null; note_excerpt: string; note_truncated: boolean; saved_fingerprint: string; saved_label: string; label_truncated: boolean }
interface Result { before: number | null; scanned_count: number; excluded_count: number; records: Row[]; has_more: boolean; next_before: number | null; retrieved_at: string; page: number }
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const time = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const optional = (value: unknown) => value === null || text(value, 64);
const control = 'min-h-9 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-left text-xs text-primary-300 disabled:opacity-40';
export function EvidenceAnalystHistory(props: Props) { return <History key={`${props.kind}:${props.recordId}`} {...props} />; }
function History({ kind, recordId }: Props) {
  const mounted = useRef(false), version = useRef(0), inFlight = useRef(false);
  const [data, setData] = useState<Result | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const clear = () => { version.current++; inFlight.current = false; setData(null); setLoading(false); setError(''); setDownloadError(''); };
  const read = async (before: number | null = null, page = 1) => {
    if (inFlight.current) return;
    const request = ++version.current; setData(null); setError(''); setDownloadError('');
    if (!positive(recordId) || !['alert', 'event'].includes(kind) || (before !== null && !positive(before))) { setError('An exact saved source and supported page cursor are required. No read was sent.'); return; }
    inFlight.current = true; setLoading(true);
    try {
      const { data: d } = await apiClient.get(`/cases/source-notes/${kind}/${recordId}`, { params: before === null ? {} : { before } });
      if (!mounted.current || request !== version.current) return;
      if (d?.schema_version !== 1 || d.kind !== kind || d.record_id !== recordId || d.before !== before || d.page_size !== 20 || d.scan_limit !== 100 || !count(d.scanned_count) || d.scanned_count > 100 || !count(d.excluded_count) || !Array.isArray(d.records) || d.records.length > 20 || d.excluded_count !== d.scanned_count - d.records.length || typeof d.has_more !== 'boolean' || !time(d.retrieved_at)) throw Error('Unconfirmed exact source page');
      if (d.has_more ? !positive(d.next_before) || d.scanned_count === 0 || (before !== null && d.next_before >= before) : d.next_before !== null) throw Error('Unconfirmed continuation');
      const records: Row[] = []; const ids = new Set<number>(); let previous = before ?? Infinity;
      for (const r of d.records) {
        if (!r || !positive(r.note_id) || r.note_id >= previous || ids.has(r.note_id) || !positive(r.case_id) || !text(r.case_title, 200) || typeof r.case_title_truncated !== 'boolean' || !optional(r.case_status) || !optional(r.case_severity) || (r.note_timestamp !== null && !time(r.note_timestamp)) || !text(r.note_excerpt, 500) || typeof r.note_truncated !== 'boolean' || typeof r.saved_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(r.saved_fingerprint) || !text(r.saved_label, 500) || typeof r.label_truncated !== 'boolean' || (d.has_more && r.note_id < d.next_before)) throw Error('Unconfirmed historical reference');
        previous = r.note_id; ids.add(r.note_id);
        records.push({ note_id: r.note_id, case_id: r.case_id, case_title: r.case_title, case_title_truncated: r.case_title_truncated, case_status: r.case_status, case_severity: r.case_severity, note_timestamp: r.note_timestamp, note_excerpt: r.note_excerpt, note_truncated: r.note_truncated, saved_fingerprint: r.saved_fingerprint, saved_label: r.saved_label, label_truncated: r.label_truncated });
      }
      setData({ before, scanned_count: d.scanned_count, excluded_count: d.excluded_count, records, has_more: d.has_more, next_before: d.next_before, retrieved_at: d.retrieved_at, page });
    } catch { if (mounted.current && request === version.current) setError('This exact owned source history could not be verified. No absence, deletion, current link or unchanged evidence is inferred. No automatic retry was made.'); }
    finally { if (mounted.current && request === version.current) { inFlight.current = false; setLoading(false); } }
  };
  const download = () => {
    if (!data || loading || error) return; setDownloadError('');
    try {
      const body = { evidence_type: 'owned_source_analyst_reference_page', schema_version: 1, kind, record_id: recordId, exported_at: new Date().toISOString(), retrieved_at: data.retrieved_at, page: data.page, before: data.before, scanned_count: data.scanned_count, excluded_count: data.excluded_count, has_more: data.has_more, next_before: data.next_before, references: data.records.map(r => ({ note_id: r.note_id, case_id: r.case_id, note_timestamp: r.note_timestamp, saved_fingerprint: r.saved_fingerprint, saved_label: r.saved_label, label_truncated: r.label_truncated })), export_scope: 'Only this loaded owner-scoped reference page, not all history. Bounded saved source labels, case/note IDs, note times and fingerprints included. Note text, case titles/status, authors, raw payloads and unknown metadata excluded. No extra read or write. Historical application references, not current links, unchanged evidence, signed proof or correct interpretation. Pages and access can change. Review the intended audience before sharing.' };
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `${kind}-${recordId}-analyst-references-page-${data.page}.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('The loaded reference page could not be downloaded. No new read or write was sent.'); }
  };
  return <section aria-label="Historical analyst references to this source" className="oa-panel min-w-0 space-y-3 p-4 text-xs [overflow-wrap:anywhere]">
    <h2 className="font-semibold text-surface-100">Analyst notes referencing this saved {kind}</h2>
    <p className="text-surface-400">Explicitly find historical source-bound human notes across your owned investigations for exact {kind} #{recordId}. A current saved link is not required. Other people's cases and counts are not disclosed. Nothing is read automatically or changed.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={loading} className={control} onClick={() => void read()}>{loading ? 'Reading analyst references...' : data ? 'Refresh first analyst reference page' : 'Read analyst source references'}</button>{(loading || data || error) && <button type="button" className={control} onClick={clear}>Clear analyst references</button>}</div>
    {loading && <p role="status">Reading one bounded page of historical references...</p>}{error && <p role="alert" className="text-warning">{error}</p>}
    {data && !loading && <>
      <p role="status">Page {data.page}: {data.records.length} supported references from {data.scanned_count} candidate notes scanned; {data.excluded_count} unsupported candidates excluded on this page.</p>
      <p className="text-surface-400">Read {data.retrieved_at}. At most 20 references and 100 candidates per page. No full-history total is claimed. Descending note IDs are navigation, not chronological proof. Notes, access and case fields can change between pages.</p>
      {!data.records.length && <p>No supported references in this candidate page. This is not proof that the source has never been investigated.{data.has_more ? ' More candidates remain; explicitly read the next page to continue.' : ''}</p>}
      <ol aria-label="Loaded analyst references" className="space-y-3">{data.records.map(row => <li key={row.note_id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h3 className="whitespace-pre-wrap font-semibold">Case #{row.case_id}: {row.case_title || 'Title not recorded'}{row.case_title_truncated ? ' [title excerpt]' : ''}</h3><p>Current case context in this read: status {row.case_status ?? 'not recorded'}, severity {row.case_severity ?? 'not recorded'}.</p><p>Note #{row.note_id} · Note time {row.note_timestamp ?? 'not recorded'}</p><p className="whitespace-pre-wrap">{row.note_excerpt}{row.note_truncated ? ' [note excerpt, truncated at 500 characters]' : ''}</p><p className="whitespace-pre-wrap text-surface-400">Saved source label: {row.saved_label || 'not recorded'}{row.label_truncated ? ' [saved label excerpt]' : ''}</p><code className="block break-all text-surface-400">{row.saved_fingerprint}</code><a className="inline-flex min-h-9 items-center text-primary-300 underline" href={`/app/cases/${row.case_id}?note=${row.note_id}`}>Open exact note #{row.note_id} in investigation #{row.case_id}</a></li>)}</ol>
      <p className="text-warning">Saved references do not prove current links, unchanged source evidence, authenticity or correct interpretation. Open the investigation to inspect its current note and explicitly compare its saved source separately.</p>
      {data.has_more && <button type="button" className={control} onClick={() => void read(data.next_before, data.page + 1)}>Read next analyst reference page</button>}
      <button type="button" className={control} onClick={download}>Download this loaded analyst reference page JSON</button><p className="text-surface-400">Only this page, not all history. Download includes saved labels, case/note IDs, times and fingerprints, not note text, case titles or authors. Review its audience before sharing. No extra read or message.</p>{downloadError && <p role="alert" className="text-warning">{downloadError}</p>}
    </>}
  </section>;
}
