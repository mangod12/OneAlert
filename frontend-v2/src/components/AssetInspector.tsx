import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import type { Asset } from '../api/types';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';

function recordedTime(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function AssetInspector({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [copyError, setCopyError] = useState(''), [copied, setCopied] = useState(false);
  const copyLink = async () => {
    setCopyError(''); setCopied(false);
    try { const url = new URL(window.location.href); url.search = ''; url.hash = ''; url.searchParams.set('asset', String(assetId)); await navigator.clipboard.writeText(url.toString()); setCopied(true); }
    catch { setCopyError('The link could not be copied. The address bar also contains this asset record link.'); }
  };

  useEffect(() => {
    let active = true;
    setLoading(true); setAsset(null); setError('');
    void apiClient.get<Asset>(`/assets/${assetId}`).then(response => {
      if (!active) return;
      if (response.data.id !== assetId) throw new Error('The response did not match this asset. Try again.');
      setAsset(response.data);
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Asset details could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assetId, retry]);

  const fields = asset ? [
    ['Asset ID', String(asset.id)], ['Type', asset.asset_type],
    ['Vendor', asset.vendor], ['Product', asset.product], ['Version', asset.version],
    ['Criticality', asset.criticality], ['Environment', asset.is_ot_asset === true ? 'OT / ICS' : asset.is_ot_asset === false ? 'IT / other' : null],
    ['Network zone', asset.network_zone], ['Primary protocol', asset.primary_protocol],
    ['Secondary protocols (recorded)', asset.secondary_protocols],
    ['Last known IP', asset.last_known_ip], ['Serial number', asset.serial_number],
    ['Model number', asset.model_number], ['Firmware version', asset.firmware_version],
    ['CPE identifier', asset.cpe_string], ['Discovery method', asset.discovery_method],
    ['Manufactured', recordedTime(asset.manufacturer_date)],
    ['Created', recordedTime(asset.created_at)], ['Last updated', recordedTime(asset.updated_at)],
  ] : [];

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="asset-inspector-heading" className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="asset-inspector-heading" className="min-w-0 break-words text-lg font-semibold text-surface-50">Asset context #{assetId}</h2>
        <button type="button" onClick={onClose} className="shrink-0 rounded-md border border-surface-600 px-3 py-1.5 text-sm text-surface-200">Close details</button>
      </div>
      <p className="mt-2 text-sm text-surface-400">Read-only inventory record. Recorded network and discovery details are not a live connectivity check.</p>
      <div className="mt-3 space-y-2"><button type="button" onClick={() => void copyLink()} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Copy asset record link</button><p className="text-xs text-surface-400">Opens this current record by ID, not a name search or frozen snapshot. This link does not grant access. Recipients need their own permission to view the asset.</p>{copied && <p role="status" className="text-xs text-primary-300">Asset record link copied.</p>}{copyError && <p role="alert" className="text-xs text-danger">{copyError}</p>}</div>
      {loading && <p role="status" className="mt-5 text-sm text-surface-300">Loading asset details...</p>}
      {error && <div className="mt-5 space-y-3"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200">Retry asset details</button></div>}
      {!loading && !error && asset && <div className="mt-5 space-y-5">
        <h3 className="break-words text-base font-semibold text-surface-50">{asset.name}</h3>
        <div className="rounded-lg border border-surface-700 p-3 text-sm text-surface-300">
          <p>Computed risk: {typeof asset.risk_score === 'number' ? `${asset.risk_level || 'unclassified'} (${asset.risk_score})` : 'Not available'}</p>
          <p className="mt-1 text-xs text-surface-400">Calculated by OneAlert from its recorded asset and alert data, not a separate scan.</p>
          <Link onClick={onClose} to={`/alerts?asset_id=${asset.id}`} className="mt-3 inline-block text-primary-400 hover:text-primary-300">Review alerts for this asset</Link>
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-surface-400">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-surface-100">{value || 'Not recorded'}</dd></div>)}
        </dl>
        <section><h3 className="text-sm font-semibold text-surface-100">Description</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-surface-300">{asset.description || 'Not recorded'}</p></section>
      </div>}
    </div>
  </div>;
}
