import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Proposal {
  device_id: number; can_promote: boolean; reviewed_fingerprint: string;
  proposed_asset: { name: string; asset_type: string; vendor: string | null; product: string | null; firmware_version: string | null; serial_number: string | null; last_known_ip: string; criticality: string; primary_protocol: string | null; secondary_protocols: string | null; description: string; discovery_method: string; is_ot_asset: boolean; version: string | null };
  existing_candidates: { id: number; name: string; last_known_ip: string | null; serial_number: string | null }[];
  existing_candidate_total: number;
}
export function DevicePromotionReview({ deviceId, onClose, onPromoted }: { deviceId: number; onClose: () => void; onPromoted: () => void }) {
  const ref = useRef<HTMLDivElement>(null), pending = useRef(false), active = useRef(true), reads = useRef(0);
  const [review, setReview] = useState<Proposal | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [ack, setAck] = useState(false), [error, setError] = useState('');
  const close = () => { if (!pending.current) onClose(); };
  useDialogFocus(ref, close);
  const load = async () => {
    if (pending.current) return;
    const request = ++reads.current; setLoading(true); setReview(null); setError(''); setBlocked(false); setAck(false);
    try {
      const { data } = await apiClient.get<Proposal>(`/ot/discovered-devices/${deviceId}/promotion-review`);
      if (!active.current || request !== reads.current) return;
      if (data.device_id !== deviceId || !data.proposed_asset?.name || !/^[a-f0-9]{64}$/.test(data.reviewed_fingerprint) || typeof data.can_promote !== 'boolean' || !Array.isArray(data.existing_candidates) || !Number.isSafeInteger(data.existing_candidate_total) || data.existing_candidate_total < data.existing_candidates.length) throw new Error('The server did not confirm this exact device promotion.');
      setReview(data);
    } catch (err) { if (active.current && request === reads.current) setError(getApiErrorMessage(err, 'Promotion review could not be loaded.')); }
    finally { if (active.current && request === reads.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; reads.current += 1; }; }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const promote = async () => {
    if (pending.current || blocked || loading || !ack || !review?.can_promote) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const { data } = await apiClient.post<{ device_id: number; asset_id: number; asset_name: string; reviewed_fingerprint: string }>(`/ot/discovered-devices/${deviceId}/promote-to-asset`, undefined, { params: { reviewed_fingerprint: review.reviewed_fingerprint } });
      if (data.device_id !== deviceId || !Number.isSafeInteger(data.asset_id) || data.asset_id <= 0 || data.asset_name !== review.proposed_asset.name || data.reviewed_fingerprint !== review.reviewed_fingerprint) throw new Error('The server did not confirm the reviewed promotion. Reload to verify the device before trying again.');
      if (active.current) onPromoted();
    } catch (err) { if (active.current) { setBlocked(true); setError(getApiErrorMessage(err, 'Promotion was not confirmed. Reload the review to verify before trying again.')); } }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={close} /><div ref={ref} role="dialog" aria-modal="true" aria-label="Review new managed asset" className="relative max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 text-surface-200 shadow-xl">
    <h2 className="text-base font-semibold">Review new managed asset</h2><p className="text-xs text-surface-400">Promoting device #{deviceId} creates one inventory record and links this discovery to it. It does not scan, connect to or change a physical device. Copied values are recorded evidence, not newly verified facts.</p>
    {loading && <p role="status">Loading current promotion proposal...</p>}{error && <p role="alert" className="break-words text-sm text-danger">{error} {blocked && 'Further writes are paused until a fresh review.'}</p>}
    {review && <><section aria-label="Proposed inventory record" className="rounded border border-surface-700 p-3 text-xs"><h3 className="mb-2 font-semibold">Proposed inventory record</h3><dl className="grid gap-2 sm:grid-cols-2">{Object.entries({Name: review.proposed_asset.name, Type: review.proposed_asset.asset_type, Vendor: review.proposed_asset.vendor, Product: review.proposed_asset.product, Version: review.proposed_asset.version, Firmware: review.proposed_asset.firmware_version, Serial: review.proposed_asset.serial_number, 'Recorded IP': review.proposed_asset.last_known_ip, Protocol: review.proposed_asset.primary_protocol, 'Additional protocols (recorded JSON)': review.proposed_asset.secondary_protocols, 'OT classification': review.proposed_asset.is_ot_asset ? 'OT' : 'Not OT', 'Inventory source': review.proposed_asset.discovery_method, Description: review.proposed_asset.description, 'Initial business criticality': review.proposed_asset.criticality}).map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="break-words">{value || 'Not recorded'}</dd></div>)}</dl></section>
    <p className="text-xs text-surface-400">Initial business criticality uses the existing discovery-risk thresholds. Review it in inventory afterward; it is not an observed impact assessment. Observation times and existing inventory records stay unchanged.</p>
    <section aria-label="Potential existing inventory"><h3 className="text-sm font-semibold">Potential existing inventory: {review.existing_candidate_total}</h3><p className="mt-1 text-xs text-surface-400">Exact recorded IP, serial or hostname/name matches only. This is not a full duplicate search or proof that records describe the same device. To use existing inventory, cancel and choose "Link existing asset".</p><ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs">{review.existing_candidates.map(asset => <li key={asset.id} className="break-words rounded border border-surface-700 p-2">#{asset.id}: {asset.name} · IP: {asset.last_known_ip || 'not recorded'} · Serial: {asset.serial_number || 'not recorded'}</li>)}</ul>{review.existing_candidate_total > review.existing_candidates.length && <p className="text-xs text-warning">Showing the first {review.existing_candidates.length} exact matches. Review inventory before creating another record.</p>}</section>
    {!review.can_promote ? <p role="status" className="text-sm text-warning">This device already has an asset link or inconsistent correlation. No new asset will be created.</p> : <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy || blocked} onChange={e => setAck(e.target.checked)} className="mt-1" /><span>I reviewed the copied fields and possible existing records. Create a new inventory asset for this device.</span></label>}</>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || loading || blocked || !ack || !review?.can_promote} onClick={() => void promote()} className="rounded bg-primary-500 px-3 py-2 text-sm font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Creating...' : 'Create reviewed asset'}</button><button type="button" disabled={busy || loading} onClick={() => void load()} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Reload promotion review</button><button type="button" disabled={busy} onClick={close} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Cancel</button></div>
  </div></div>;
}
