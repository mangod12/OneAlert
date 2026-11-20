import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Review {
  asset_id: number; name: string; asset_type: string; criticality: string | null; is_ot_asset: boolean | null;
  dependencies: { alerts: number; sboms: number; discovered_devices: number; suppression_rules: number };
  can_delete: boolean; reviewed_fingerprint: string;
}
const labels = { alerts: 'Alert records, including closed alerts', sboms: 'SBOM documents', discovered_devices: 'Correlated discovered devices', suppression_rules: 'Asset-specific suppression rules' };
export function AssetRemovalReview({ id, onClose, onDeleted }: { id: number; onClose: () => void; onDeleted: () => void }) {
  const ref = useRef<HTMLDivElement>(null), pending = useRef(false), active = useRef(true), sequence = useRef(0);
  const [review, setReview] = useState<Review | null>(null), [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState('');
  const close = () => { if (!pending.current) onClose(); };
  useDialogFocus(ref, close);
  const load = async () => {
    if (pending.current) return;
    const request = ++sequence.current;
    setLoading(true); setReview(null); setConfirmed(false); setBlocked(false); setError('');
    try {
      const { data } = await apiClient.get<Review>(`/assets/${id}/removal-review`);
      if (!active.current || request !== sequence.current) return;
      const counts = Object.keys(labels).map(key => data.dependencies?.[key as keyof typeof labels]);
      if (data.asset_id !== id || !data.name || !/^[a-f0-9]{64}$/.test(data.reviewed_fingerprint) || counts.some(value => !Number.isSafeInteger(value) || value < 0) || data.can_delete !== counts.every(value => value === 0)) throw new Error('The server did not confirm this exact removal review.');
      setReview(data);
    } catch (err) { if (active.current && request === sequence.current) setError(getApiErrorMessage(err, 'Asset removal review could not be loaded.')); }
    finally { if (active.current && request === sequence.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; sequence.current += 1; }; }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async () => {
    if (pending.current || !review?.can_delete || !confirmed || blocked || loading) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await apiClient.delete(`/assets/${id}`, { params: { reviewed_fingerprint: review.reviewed_fingerprint } });
      if (response.status !== 204) throw new Error('The server did not confirm removal. Reload the review to verify before trying again.');
      if (active.current) onDeleted();
    } catch (err) { if (active.current) { setBlocked(true); setError(getApiErrorMessage(err, 'Removal was not confirmed. Reload the review to verify current inventory before trying again.')); } }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={close} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Review asset removal" className="relative max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 text-surface-200 shadow-xl">
      <h2 className="text-base font-semibold">Review asset removal</h2>
      <p className="text-xs text-surface-400">Only an asset with no linked records can be removed. This does not retire or disconnect a physical device, delete its linked evidence, or disable monitoring on a device.</p>
      {loading && <p role="status">Checking current asset and linked records...</p>}
      {error && <p role="alert" className="break-words text-sm text-danger">{error} {blocked && 'Removal is paused until you reload this review.'}</p>}
      {review && <><p className="break-words text-sm font-medium">Asset #{review.asset_id}: {review.name}</p><p className="text-xs">{review.asset_type} · {review.is_ot_asset ? 'OT' : 'IT / unclassified'} · Criticality: {review.criticality || 'not recorded'}</p>
        <dl className="space-y-2 rounded border border-surface-700 p-3 text-sm">{Object.entries(labels).map(([key, label]) => <div key={key} className="flex items-start justify-between gap-4"><dt>{label}</dt><dd>{review.dependencies[key as keyof typeof labels]}</dd></div>)}</dl>
        {!review.can_delete ? <p role="status" className="text-sm text-warning">Removal blocked. Retain this asset while these records reference it. Review or unlink records in their own workflows, then reload this review. Nothing has been deleted or unlinked.</p> : <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy || blocked} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" /><span>I reviewed this asset and understand that removing its inventory record cannot be undone.</span></label>}
      </>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || loading || blocked || !review?.can_delete || !confirmed} onClick={() => void remove()} className="rounded bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Removing...' : 'Remove reviewed asset'}</button><button type="button" disabled={busy || loading} onClick={() => void load()} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Reload removal review</button><button type="button" disabled={busy} onClick={close} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Cancel</button></div>
    </div>
  </div>;
}
