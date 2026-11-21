import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
type Kind = 'alert' | 'event';
interface Snapshot { case_id: number; case_title: string; kind: Kind; search: string; severity: string; page: number; size: number; total: number; available_count: number; unavailable_reference_count: number; retrieved_at: string; records: (Record<string, unknown> & { id: number; can_open_original: boolean })[] }
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const recorded = (value: unknown) => value === null || value === undefined || value === '' ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function CaseLinkedEvidence() {
  const { caseId = '' } = useParams(); const [params, setParams] = useSearchParams(); const kinds = params.getAll('kind'), kind = kinds[0] || 'alert';
  const validId = /^[1-9][0-9]*$/.test(caseId) && Number(caseId) <= 2147483647;
  const validKind = kinds.length === 0 || (kinds.length === 1 && ['alert', 'event'].includes(kinds[0]));
  return <div className="space-y-5"><PageHeader eyebrow="Investigations" title="Linked investigation evidence" description="Read-only paging and search across the current records linked to one visible investigation." />
    <a className="inline-block text-sm text-primary-300" href={validId ? `/app/cases/${Number(caseId)}` : '/app/cases'}>Back to investigation{validId ? ` #${caseId}` : 's'}</a>
    {!validId || !validKind ? <p role="alert" className="text-sm text-danger">This link needs a positive investigation ID and one alert or event evidence type. No linked records were loaded.</p> : <>
      <div role="group" aria-label="Linked evidence type" className="flex flex-wrap gap-3 text-xs">{(['alert', 'event'] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setParams({ kind: value })} className="rounded border border-surface-600 px-3 py-2 text-primary-300 aria-pressed:border-primary-400 aria-pressed:bg-primary-500/10">Linked {value}s</button>)}</div>
      <EvidenceRows key={`${caseId}:${kind}`} caseId={Number(caseId)} kind={kind as Kind} />
    </>}
  </div>;
}
function EvidenceRows({ caseId, kind }: { caseId: number; kind: Kind }) {
  const [draft, setDraft] = useState(''), [search, setSearch] = useState(''), [severity, setSeverity] = useState('all'), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''); const request = useRef(0);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState(''); const exportBusy = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const read = ++request.current; setExportError(''); setSnapshot(null); setError(''); setLoading(true);
    void apiClient.get<Snapshot>(`/cases/${caseId}/linked-evidence`, { params: { kind, search, severity, page, size: 10 } }).then(({ data }) => {
      if (read !== request.current) return;
      if (data.case_id !== caseId || data.kind !== kind || data.search !== search || data.severity !== severity || data.page !== page || data.size !== 10 || !count(data.total) || !count(data.available_count) || !count(data.unavailable_reference_count) || !Array.isArray(data.records) || data.records.length > 10 || new Set(data.records.map(row => row.id)).size !== data.records.length || data.records.some(row => !count(row.id) || row.id === 0 || typeof row.can_open_original !== 'boolean')) throw new Error('The linked evidence did not match this investigation, type, filters or page. Retry before relying on it.');
      const last = Math.max(1, Math.ceil(data.total / 10)); if (page > last) { setPage(last); return; } setSnapshot(data);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Linked investigation evidence could not be loaded.')); }).finally(() => { if (read === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [caseId, kind, search, severity, page, retry]);
  async function exportEvidence() {
    if (exportBusy.current || !snapshot || loading || error) return;
    const read = request.current; exportBusy.current = true; setExporting(true); setExportError('');
    try {
      const response = await apiClient.get(`/cases/${caseId}/linked-evidence/export`, { params: { kind, search, severity }, responseType: 'blob' });
      if (read !== request.current) return;
      if (!(response.data instanceof Blob) || !response.data.type.startsWith('text/csv')) throw new Error('The server did not return an evidence CSV. No file was downloaded.');
      const url = URL.createObjectURL(response.data); const anchor = document.createElement('a');
      try { anchor.href = url; anchor.download = `case-${caseId}-linked-${kind}s.csv`; document.body.appendChild(anchor); anchor.click(); }
      finally { anchor.remove(); URL.revokeObjectURL(url); }
    } catch (err) {
      if (read !== request.current) return;
      const response = (err as { response?: { data?: unknown } }).response;
      if (response?.data instanceof Blob) {
        try { response.data = JSON.parse(await response.data.text()); } catch { /* Use the normal fallback. */ }
      }
      if (read === request.current) setExportError(getApiErrorMessage(err, 'Linked evidence export failed. No file was downloaded.'));
    } finally { exportBusy.current = false; if (mounted.current) setExporting(false); }
  }
  return <section aria-label={`Linked ${kind} records`} className="space-y-4">
    <p className="text-sm text-surface-400">This view follows investigation visibility. Only evidence belonging to the investigation owner is included; missing or unrelated-owner references stay unavailable. Each original record appears once even if old links are duplicated. It does not link, unlink, edit or run response actions.</p>
    <form className="oa-panel flex flex-wrap items-end gap-3 p-4" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(1); setRetry(n => n + 1); }}><label className="min-w-0 text-xs text-surface-300">Search linked {kind}s<input aria-label="Search linked investigation evidence" value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} className="mt-1 block w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm" /></label><button type="submit" className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Search linked evidence</button><label className="text-xs text-surface-300">Recorded severity<select aria-label="Linked evidence severity" value={severity} onChange={event => { setSeverity(event.target.value); setPage(1); }} className="mt-1 block rounded border border-surface-600 bg-surface-950 p-2 text-sm"><option value="all">All severities</option>{['critical', 'high', 'medium', 'low', 'info'].map(value => <option key={value} value={value}>{value}</option>)}</select></label></form>
    {draft.trim() !== search && <p className="text-xs text-warning">Search draft not applied. Results use the last submitted search.</p>}
    {loading && <p role="status" className="text-sm text-surface-300">Loading linked evidence...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="button" disabled={loading} onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Refresh linked investigation evidence</button>
    {exportError && <p role="alert" className="text-sm text-danger">{exportError}</p>}
    {!loading && !error && snapshot && <>
      <div className="oa-panel space-y-2 p-4"><button type="button" disabled={exporting} onClick={() => void exportEvidence()} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">{exporting ? 'Preparing evidence CSV...' : 'Export all matching linked evidence'}</button><p className="text-xs text-surface-400">Downloads all currently matching linked {kind} records, not only this page. Uses the applied search and severity, never an unapplied draft. Up to 10,000 records; larger exports are refused without a partial file. CSV includes investigation and filter context. It is a current read, not a frozen capture or the original raw payload. Unavailable private references are excluded.</p></div>
      <div className="oa-panel space-y-2 p-4 text-sm text-surface-300"><h2 className="break-words font-semibold">Investigation #{caseId}: {snapshot.case_title}</h2><p>{snapshot.total} matching linked {kind} records · {snapshot.available_count} available before filters</p><p className="break-words text-xs text-surface-400">Applied search: {search || 'All linked keywords'} · Severity: {severity}. Received {snapshot.retrieved_at}. Counts and rows are separate current reads, not a frozen evidence capture. Labels and timestamps are recorded values, not verified activity.</p>{snapshot.unavailable_reference_count > 0 && <p className="text-xs text-warning">{snapshot.unavailable_reference_count} original references are unavailable. Their private contents are not included.</p>}</div>
      {!snapshot.records.length && <p className="text-sm text-surface-400">No available linked {kind} records match these filters. This does not establish that no evidence exists or that the investigation has no unavailable references.</p>}
      <ol className="space-y-3">{snapshot.records.map(row => <li key={row.id} className="oa-panel space-y-3 p-4 text-sm text-surface-200"><h3 className="break-words font-semibold">{kind === 'alert' ? 'Alert' : 'Event'} #{row.id}: {recorded(row.title ?? row.signature ?? row.event_type)}</h3><dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries(row).filter(([field]) => !['id', 'can_open_original'].includes(field)).map(([field, value]) => <div key={field} className="min-w-0"><dt className="text-surface-400">{field.replaceAll('_', ' ')}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{recorded(value)}</dd></div>)}</dl>{row.can_open_original ? <a className="inline-block text-xs text-primary-300" href={kind === 'alert' ? `/app/alerts?alert=${row.id}` : `/app/events/${row.id}`}>Open exact {kind} #{row.id}</a> : <p className="text-xs text-surface-400">The original record link is limited to its owner. This read follows the investigation's visibility.</p>}</li>)}</ol>
      <div className="flex flex-wrap items-center gap-3 text-xs text-surface-300"><span>Page {page} of {Math.max(1, Math.ceil(snapshot.total / 10))}</span><button disabled={page <= 1} onClick={() => setPage(n => n - 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Previous linked evidence</button><button disabled={page * 10 >= snapshot.total} onClick={() => setPage(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">More linked evidence</button></div>
    </>}
  </section>;
}
