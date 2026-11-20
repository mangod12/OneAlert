import { useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { ConfirmDialog } from './ui/ConfirmDialog';
import type { Asset } from '../api/types';

export function AssetCriticalityReview({ assets, onSaved, onBusy }: { assets: Asset[]; onBusy: (busy: boolean) => void; onSaved: (saved: Map<number, string>) => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [criticality, setCriticality] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState('');
  const rows = assets.filter(asset => selected.has(asset.id));
  const apply = async () => {
    if (pending.current || !rows.length || !criticality) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setNotice('');
    const snapshot = [...rows];
    const saved = new Map<number, string>();
    const failed: Record<number, string> = {};
    for (let start = 0; start < snapshot.length; start += 5) {
      await Promise.all(snapshot.slice(start, start + 5).map(async asset => {
        try {
          const response = await apiClient.put<Asset>(`/assets/${asset.id}`, { criticality });
          if (response.data.id !== asset.id || response.data.criticality !== criticality) throw new Error('The server did not confirm the requested asset criticality. Reload inventory to verify before retrying.');
          saved.set(asset.id, response.data.criticality);
        } catch (error) {
          failed[asset.id] = getApiErrorMessage(error, 'Criticality could not be saved. This asset remains selected.');
        }
      }));
    }
    onSaved(saved);
    setErrors(failed);
    setSelected(current => new Set([...current].filter(id => !saved.has(id))));
    setNotice(`Confirmed criticality changes for ${saved.size} of ${snapshot.length} selected assets. ${Object.keys(failed).length ? 'Failed or unconfirmed assets remain selected. Review their errors before retrying.' : 'Other asset fields were not changed.'}`);
    pending.current = false;
    setBusy(false);
    onBusy(false);
    setConfirm(false);
  };
  return <section aria-label="Asset criticality review" className="space-y-3 rounded border border-surface-700 p-4">
    <h2 className="text-sm font-semibold text-surface-100">Review asset criticality</h2>
    <p className="text-xs text-surface-400">Select assets from this loaded page only. Criticality is business impact, not a vulnerability risk score. Changes affect prioritization, not the recorded risk score, asset type or OT classification. Selection resets when you change the inventory page or filters.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setSelected(new Set(assets.map(asset => asset.id)))} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Select this asset page</button><button type="button" disabled={busy || !rows.length} onClick={() => setSelected(new Set())} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Clear asset selection</button></div>
    <ul aria-label="Asset criticality selection" tabIndex={0} className="max-h-60 space-y-2 overflow-y-auto">{assets.map(asset => <li key={asset.id} className="text-xs text-surface-300"><label className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={selected.has(asset.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(asset.id); else next.delete(asset.id); return next; })} aria-label={`Select criticality for ${asset.name}`} /><span className="break-words">#{asset.id}: {asset.name} · Current criticality: {asset.criticality || 'not recorded'}</span></label>{errors[asset.id] && <p role="alert" className="mt-1 text-danger">{errors[asset.id]}</p>}</li>)}</ul>
    <p className="text-xs text-surface-300">{rows.length} of {assets.length} loaded-page assets selected. No other pages are selected.</p>
    {!!rows.length && <><label className="block text-xs text-surface-300">New criticality<select aria-label="New asset criticality" disabled={busy} value={criticality} onChange={event => setCriticality(event.target.value)} className="ml-2 rounded border border-surface-600 bg-surface-950 px-2 py-2 text-sm text-surface-100"><option value="">Choose criticality</option>{['low', 'medium', 'high', 'critical'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><button type="button" disabled={busy || !criticality} onClick={() => setConfirm(true)} className="rounded bg-primary-500 px-3 py-2 text-sm text-surface-950 disabled:opacity-40">Review criticality change</button></>}
    {notice && <p role={Object.keys(errors).length ? 'alert' : 'status'} className="text-sm text-surface-200">{notice} Inventory filters and order describe the loaded snapshot; refresh to apply them again.</p>}
    {confirm && <ConfirmDialog title="Change selected asset criticality" description={`Set business criticality to ${criticality} for ${rows.length} selected assets on this loaded page? Only criticality changes. Risk scores, OT classification and other asset fields stay unchanged.`} confirmLabel={`Apply to ${rows.length} assets`} busy={busy} onCancel={() => { if (!busy) setConfirm(false); }} onConfirm={() => void apply()} />}
  </section>;
}
