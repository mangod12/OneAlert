import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Candidate { id: number; name: string; vendor?: string | null; product?: string | null }
interface Device { id: number; ip_address: string; hostname: string | null; manufacturer: string | null; model: string | null; firmware_version: string | null; serial_number: string | null; asset_id: number | null; is_correlated: boolean }
interface Asset extends Candidate { asset_type: string; version: string | null; firmware_version: string | null; serial_number: string | null; last_known_ip: string | null; criticality: string | null }
interface Review { device: Device; asset: Asset; can_link: boolean; reviewed_fingerprint: string }
export function DeviceAssetLinkReview({ deviceId, onClose, onLinked }: { deviceId: number; onClose: () => void; onLinked: () => void }) {
  const dialog = useRef<HTMLDivElement>(null), pending = useRef(false), active = useRef(true), reads = useRef(0);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [assets, setAssets] = useState<Candidate[]>([]), [total, setTotal] = useState(0);
  const [review, setReview] = useState<Review | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [ack, setAck] = useState(false), [error, setError] = useState('');
  const close = () => { if (!pending.current) onClose(); };
  useDialogFocus(dialog, close);
  useEffect(() => { active.current = true; return () => { active.current = false; reads.current += 1; }; }, []);
  useEffect(() => {
    const request = ++reads.current;
    setLoading(true); setAssets([]); setReview(null); setAck(false); setBlocked(false); setError('');
    void apiClient.get<{ assets: Candidate[]; total: number }>('/assets/', { params: { page, size: 10, sort: 'name_asc', ...(query.trim() ? { search: query.trim() } : {}) } }).then(({ data }) => {
      if (active.current && request === reads.current) { setAssets(data.assets); setTotal(data.total); }
    }).catch(err => { if (active.current && request === reads.current) setError(getApiErrorMessage(err, 'Managed assets could not be loaded.')); })
      .finally(() => { if (active.current && request === reads.current) setLoading(false); });
  }, [page, query, retry]);
  const loadReview = async (assetId: number) => {
    if (pending.current) return;
    const request = ++reads.current;
    setLoading(true); setReview(null); setError(''); setAck(false); setBlocked(false);
    try {
      const { data } = await apiClient.get<Review>(`/ot/discovered-devices/${deviceId}/correlation-review/${assetId}`);
      if (!active.current || request !== reads.current) return;
      if (data.device.id !== deviceId || data.asset.id !== assetId || !/^[a-f0-9]{64}$/.test(data.reviewed_fingerprint) || typeof data.can_link !== 'boolean' || data.can_link !== (data.device.asset_id === null && !data.device.is_correlated)) throw new Error('The server did not confirm these exact records.');
      setReview(data);
    } catch (err) { if (active.current && request === reads.current) setError(getApiErrorMessage(err, 'Correlation review could not be loaded.')); }
    finally { if (active.current && request === reads.current) setLoading(false); }
  };
  const link = async () => {
    if (pending.current || blocked || !ack || !review?.can_link || loading) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const { data } = await apiClient.post<Device & { correlation_score: number }>(`/ot/discovered-devices/${deviceId}/correlate/${review.asset.id}`, undefined, { params: { reviewed_fingerprint: review.reviewed_fingerprint } });
      if (data.id !== deviceId || data.asset_id !== review.asset.id || data.is_correlated !== true || data.correlation_score !== 100) throw new Error('The server did not confirm the exact association. Reload the review to verify before retrying.');
      if (active.current) onLinked();
    } catch (err) { if (active.current) { setBlocked(true); setError(getApiErrorMessage(err, 'Association was not confirmed. Reload the review before retrying.')); } }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div aria-hidden="true" className="absolute inset-0 bg-surface-950/70" onClick={close} />
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Link discovered device to existing asset" className="relative max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 text-surface-200 shadow-xl">
      <h2 className="text-base font-semibold">Link discovered device to existing asset</h2><p className="text-xs text-surface-400">Device #{deviceId}. Search your inventory and review both saved records. This is a manual association, not proof of a physical match or a new network observation. No new asset is created and inventory fields stay unchanged.</p>
      <label className="block text-sm">Search managed assets<input aria-label="Search managed assets" disabled={busy} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} className="mt-1 w-full rounded border border-surface-600 bg-surface-950 p-2" /></label>
      {loading && <p role="status">Loading current records...</p>}{error && <p role="alert" className="break-words text-sm text-danger">{error} {blocked && 'Further writes are paused until you reload the review.'}</p>}
      <button type="button" disabled={busy || loading} onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs disabled:opacity-40">Reload asset search</button>
      {!loading && assets.length === 0 && !error && <p className="text-sm text-surface-400">No matching managed assets.</p>}
      {!loading && <><ul aria-label="Managed asset candidates" className="max-h-44 space-y-2 overflow-y-auto">{assets.map(asset => <li key={asset.id}><button type="button" disabled={busy} onClick={() => void loadReview(asset.id)} className="w-full break-words rounded border border-surface-700 p-2 text-left text-sm disabled:opacity-40">Review asset #{asset.id}: {asset.name}<span className="block text-xs text-surface-400">{asset.vendor} {asset.product}</span></button></li>)}</ul><div className="flex items-center gap-3 text-xs"><button type="button" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border border-surface-600 p-2 disabled:opacity-40">Previous assets</button><span>Page {page} · {total} matching assets</span><button type="button" disabled={busy || page * 10 >= total} onClick={() => setPage(value => value + 1)} className="rounded border border-surface-600 p-2 disabled:opacity-40">Next assets</button></div></>}
      {review && <><section aria-label="Device and inventory record comparison" className="grid gap-3 sm:grid-cols-2">{[{ title: `Discovered device #${review.device.id}`, rows: [['IP', review.device.ip_address], ['Hostname', review.device.hostname], ['Manufacturer', review.device.manufacturer], ['Model', review.device.model], ['Firmware', review.device.firmware_version], ['Serial', review.device.serial_number]] }, { title: `Managed asset #${review.asset.id}`, rows: [['Name', review.asset.name], ['Recorded IP', review.asset.last_known_ip], ['Vendor', review.asset.vendor], ['Product', review.asset.product], ['Version / firmware', review.asset.firmware_version || review.asset.version], ['Serial', review.asset.serial_number]] }].map(panel => <div key={panel.title} className="rounded border border-surface-700 p-3 text-xs"><h3 className="mb-2 font-semibold">{panel.title}</h3><dl className="space-y-1">{panel.rows.map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="break-words">{value || 'Not recorded'}</dd></div>)}</dl></div>)}</section>
      {!review.can_link ? <p role="status" className="text-sm text-warning">This device already has a link or an inconsistent correlation state. No link will be overwritten.</p> : <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy || blocked} onChange={e => setAck(e.target.checked)} className="mt-1" /><span>I reviewed both records and want to associate this device with asset #{review.asset.id}: {review.asset.name}.</span></label>}
      <button type="button" disabled={busy || loading} onClick={() => void loadReview(review.asset.id)} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Reload correlation review</button></>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || blocked || loading || !ack || !review?.can_link} onClick={() => void link()} className="rounded bg-primary-500 px-3 py-2 text-sm font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Linking...' : 'Link reviewed records'}</button><button type="button" disabled={busy} onClick={close} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Cancel</button></div>
    </div>
  </div>;
}
