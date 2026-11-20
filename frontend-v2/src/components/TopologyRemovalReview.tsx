import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Snapshot { connection: Record<string, unknown> & { id: number; bytes_transferred: string | null }; reviewed_fingerprint: string; retrieved_at: string }
export function TopologyRemovalReview({ connectionId, onClose, onRemoved }: { connectionId: number; onClose: () => void; onRemoved: () => void }) {
  const dialog = useRef<HTMLDivElement>(null), pending = useRef(false); useDialogFocus(dialog, () => { if (!pending.current) onClose(); });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [acknowledged, setAcknowledged] = useState(false), [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setSnapshot(null); setError(''); setAcknowledged(false); setUncertain(false);
    void apiClient.get<Snapshot>(`/topology/connections/${connectionId}/removal-review`).then(({ data }) => {
      if (!active) return;
      if (data.connection?.id !== connectionId || !/^[a-f0-9]{64}$/.test(data.reviewed_fingerprint) || (data.connection.bytes_transferred !== null && (typeof data.connection.bytes_transferred !== 'string' || !/^-?[0-9]+$/.test(data.connection.bytes_transferred)))) throw new Error('The saved record did not match this connection. Reload before removing anything.');
      setSnapshot(data);
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Removal review could not be loaded.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [connectionId, retry]);
  const remove = async () => {
    if (pending.current || !snapshot || !acknowledged || uncertain) return;
    pending.current = true; setBusy(true); setError('');
    try { const response = await apiClient.delete(`/topology/connections/${connectionId}`, { params: { reviewed_fingerprint: snapshot.reviewed_fingerprint } }); if (response.status !== 204) throw new Error('Removal was not acknowledged with the expected response.'); onRemoved(); }
    catch (err) { setUncertain(true); setAcknowledged(false); setError(getApiErrorMessage(err, 'Removal could not be confirmed. Reload the saved record before another attempt.')); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review saved connection removal" className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 text-surface-300">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Review saved connection removal</h2><button type="button" disabled={busy} onClick={onClose} className="rounded border border-surface-600 px-3 py-2 text-xs disabled:opacity-40">Cancel connection removal</button></div>
    <p className="text-sm text-surface-400">This permanently deletes one saved topology connection record. It does not disconnect devices, block traffic, remove event telemetry or verify that a network flow stopped. Graph and stats change because this saved record is gone. There is no undo here.</p>
    {loading && <p role="status">Loading current saved connection...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}{uncertain && <p className="text-sm text-warning">The record may have changed or removal may already have happened. Reload current evidence before retrying. A missing record does not establish who removed it.</p>}
    {!loading && snapshot && <section className="space-y-3 rounded border border-surface-700 p-3"><h3 className="font-semibold text-surface-100">Saved connection #{snapshot.connection.id}</h3><p className="text-xs text-surface-400">Read at {snapshot.retrieved_at}. Recorded values are not verified traffic capture. Bytes are exact stored integer text.</p><dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries(snapshot.connection).map(([field, value]) => <div className="min-w-0" key={field}><dt className="text-surface-400">{field.replaceAll('_', ' ')}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value === null || value === undefined || value === '' ? 'Not recorded' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</dd></div>)}</dl></section>}
    <button type="button" disabled={loading || busy} onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs disabled:opacity-40">Reload connection removal review</button>
    {!loading && snapshot && !uncertain && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this exact saved record and understand that removal has no undo here.</label>}
    <button type="button" disabled={loading || busy || !snapshot || !acknowledged || uncertain} onClick={() => void remove()} className="rounded border border-danger/40 px-3 py-2 text-xs text-danger disabled:opacity-40">{busy ? 'Removing saved connection...' : 'Remove reviewed saved connection'}</button>
  </div></div>;
}
