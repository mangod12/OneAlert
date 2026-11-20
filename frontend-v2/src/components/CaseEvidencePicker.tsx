import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Candidate { id: number; kind: 'alert' | 'event'; title: string; severity: string | null; detail: string | null; timestamp: string | null }
interface Result { data: Candidate[]; total: number; page: number; size: number; kind: string; case_id: number }
const style = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 disabled:opacity-40';
export function CaseEvidencePicker({ caseId, kind, onCancel, onLinked }: { caseId: number; kind: 'alert' | 'event'; onCancel: () => void; onLinked: (created: boolean) => void }) {
  const dialog = useRef<HTMLDivElement>(null), mounted = useRef(true), pending = useRef(false), generation = useRef(0);
  const [draft, setDraft] = useState(''), [query, setQuery] = useState(''), [severity, setSeverity] = useState('all'), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [selected, setSelected] = useState<number | null>(null);
  useDialogFocus(dialog, () => { if (!pending.current) onCancel(); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    let active = true; setResult(null); setSelected(null); setError(''); setLoading(true);
    apiClient.get<Result>(`/cases/${caseId}/evidence-candidates`, { params: { kind, page, size: 10, query, severity } }).then(response => {
      if (!active) return;
      const value = response.data;
      if (value.case_id !== caseId || value.kind !== kind || value.page !== page || value.size !== 10 || !Array.isArray(value.data) || !Number.isSafeInteger(value.total) || value.total < 0 || value.data.some(row => row.kind !== kind || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.title !== 'string' || (row.severity !== null && typeof row.severity !== 'string'))) throw new Error('Evidence candidates did not match this investigation, type or page. Retry before linking.');
      setResult(value);
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Linkable evidence could not be loaded. Missing records do not establish an empty inventory.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, kind, page, query, severity, retry]);
  const choice = result?.data.find(row => row.id === selected);
  const link = async () => {
    if (pending.current || loading || error || !choice) return;
    pending.current = true; const token = generation.current; setBusy(true); setError('');
    try {
      const response = await apiClient.post(`/cases/${caseId}/${kind === 'alert' ? 'alerts' : 'events'}/${choice.id}`);
      if (!mounted.current || generation.current !== token) return;
      if (response.data?.success !== true || typeof response.data?.data?.linked !== 'boolean') throw new Error('The reply did not confirm whether the record was linked. Refresh candidates before trying again.');
      onLinked(response.data.data.linked as boolean);
    } catch (err) { if (mounted.current) { setSelected(null); setError(getApiErrorMessage(err, 'The record could not be linked. Refresh candidates before retrying.')); } }
    finally { if (mounted.current) { pending.current = false; setBusy(false); } }
  };
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 10));
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label={`Link an ${kind}`} className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5">
    <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Link an {kind} to investigation #{caseId}</h2><button type="button" className={style} disabled={busy} onClick={onCancel}>Cancel</button></div>
    <p className="text-xs text-surface-400">Search all your owned, currently unlinked {kind === 'alert' ? 'alerts by title, description, CVE or ID' : 'events by signature, event type, source/destination IP or ID'}, not only recent records. Dates are {kind === 'alert' ? 'alert creation' : 'event occurrence'} times. Results can change between reads.</p>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (busy) return; setQuery(draft.trim()); setPage(1); setSelected(null); }}><input aria-label={`Search linkable ${kind}s`} maxLength={200} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} className={`${style} min-w-0 flex-1 basis-full sm:basis-0`} /><button className={style} type="submit" disabled={busy}>Search evidence</button><select aria-label="Candidate severity" className={style} value={severity} disabled={busy} onChange={event => { setSeverity(event.target.value); setPage(1); setSelected(null); }}><option value="all">All severities</option>{['critical','high','medium','low','info'].map(value => <option key={value} value={value}>{value}</option>)}</select></form>
    {draft.trim() !== query && <p className="text-xs text-warning">Search draft not applied. Results use {query ? `"${query}"` : 'all keywords'}.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="button" disabled={busy || loading} className={style} onClick={() => setRetry(value => value + 1)}>Refresh evidence candidates</button>
    {loading ? <p role="status" className="text-sm text-surface-400">Loading linkable evidence...</p> : result && !error && <>
      <p role="status" className="text-xs text-surface-400">{result.total} owned, unlinked {kind} records match. Page {page} of {pages}.</p>
      {!result.data.length && <p className="text-sm text-surface-300">No linkable records match this page and these filters. Clear the search/severity or return to the first page. This does not mean every record in your inventory is linked.</p>}
      <fieldset disabled={busy} className="space-y-2"><legend className="sr-only">Choose exact evidence record</legend>{result.data.map(row => <label key={row.id} className="flex min-w-0 items-start gap-3 rounded border border-surface-700 p-3 text-xs text-surface-300"><input type="radio" name="evidence-candidate" className="mt-1 shrink-0" checked={selected === row.id} onChange={() => setSelected(row.id)} aria-label={`Select ${kind} #${row.id}`} /><span className="min-w-0 space-y-1"><span className="block break-words font-semibold text-surface-100">{kind === 'alert' ? 'Alert' : 'Event'} #{row.id}: {row.title}</span><span className="block break-words">{row.severity ?? 'Severity not recorded'} · {row.detail ?? 'Detail not recorded'}</span><span className="block break-words">{row.timestamp ? new Date(row.timestamp).toLocaleString() : 'Time not recorded'}</span></span></label>)}</fieldset>
      <nav aria-label="Evidence candidate pages" className="flex flex-wrap gap-2"><button className={style} type="button" disabled={busy || page === 1} onClick={() => setPage(1)}>First evidence page</button><button className={style} type="button" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>Previous evidence page</button><button className={style} type="button" disabled={busy || page >= pages} onClick={() => setPage(value => value + 1)}>Next evidence page</button></nav>
    </>}
    <p className="text-xs text-warning">{kind === 'alert' ? 'Linking an alert may raise investigation severity to match it.' : 'Linking an event also marks that event as in this investigation.'} Neither action runs response actions, closes alerts or changes the original evidence content.</p>
    {choice && !error && <p className="break-words text-sm text-surface-200">Selected {kind} #{choice.id}: {choice.title}. Destination: investigation #{caseId}.</p>}
    <button type="button" className={style} disabled={busy || loading || !!error || !choice} onClick={() => void link()}>{busy ? 'Linking evidence...' : `Link selected ${kind}`}</button>
  </div></div>;
}
