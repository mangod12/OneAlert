import { AssetComparison } from '../components/AssetComparison';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import type { Asset, AssetCreate, AssetListResponse } from '../api/types';
import { Plus, Search, Server, ShieldAlert, Trash2, Edit2, Download } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { criticalityTones } from '../components/ui/tones';
import { useDialogFocus } from '../components/ui/useDialogFocus';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { AssetCriticalityReview } from '../components/AssetCriticalityReview';
import { AssetInspector } from '../components/AssetInspector';
import { toast } from '../components/Toast';

const FALLBACK_ASSET_TYPES = ['hardware', 'software', 'firmware', 'operating_system', 'plc', 'hmi', 'rtu', 'ied', 'scada_server', 'historian'];
const ACRONYMS = new Set(['plc', 'hmi', 'rtu', 'ied', 'scada']);
function assetTypeLabel(value: string): string {
  return value.split('_').map(word => ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function Assets() {
  const [comparison, setComparison] = useState<number[]>([]);
  const [comparisonRevision, setComparisonRevision] = useState(0);
  const [showCriticalityReview, setShowCriticalityReview] = useState(false);
  const [criticalityBusy, setCriticalityBusy] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const requestId = useRef(0);
  const [page, setPage] = useState(1);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [inspectAssetId, setInspectAssetId] = useState<number | null>(null);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [criticalityFilter, setCriticalityFilter] = useState('');
  const [otFilter, setOtFilter] = useState('');
  const [sort, setSort] = useState('created_at_desc');
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params: Record<string, string> = { sort };
      if (typeFilter) params.asset_type = typeFilter;
      if (vendorFilter) params.vendor = vendorFilter;
      if (criticalityFilter) params.criticality = criticalityFilter;
      if (otFilter) params.is_ot = otFilter;
      if (search.trim()) params.search = search.trim();
      const res = await apiClient.get('/assets/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'assets.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The export could not be downloaded.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const fetchAssets = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, size: 15 };
      if (search) params.search = search;
      if (typeFilter) params.asset_type = typeFilter;
      if (vendorFilter) params.vendor = vendorFilter;
      if (criticalityFilter) params.criticality = criticalityFilter;
      if (otFilter) params.is_ot = otFilter;
      params.sort = sort;
      const res = await apiClient.get<AssetListResponse>('/assets/', { params });
      if (request !== requestId.current) return;
      const lastPage = Math.max(1, Math.ceil(res.data.total / 15));
      if (page > lastPage) { setPage(lastPage); return; }
      setAssets(res.data.assets);
      setTotal(res.data.total);
    } catch (err: unknown) {
      if (request === requestId.current) setError(getApiErrorMessage(err, 'Asset inventory could not be loaded.'));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [page, search, typeFilter, vendorFilter, criticalityFilter, otFilter, sort]);

  const [assetTypes, setAssetTypes] = useState<string[]>(FALLBACK_ASSET_TYPES);

  useEffect(() => {
    void fetchAssets();
    return () => { requestId.current += 1; };
  }, [fetchAssets]);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<string[]>('/assets/types/').then(res => {
      if (!cancelled && Array.isArray(res.data) && res.data.length > 0) setAssetTypes(res.data);
    }).catch(() => { /* keep the fallback list */ });
    apiClient.get<string[]>('/assets/vendors/').then(res => {
      if (!cancelled && Array.isArray(res.data)) setVendorOptions(res.data);
    }).catch(() => { /* no vendor filter without a list */ });
    return () => { cancelled = true; };
  }, []);

  const requestDelete = (asset: Asset) => {
    if (!deletingIds.has(asset.id)) setPendingDelete(asset);
  };

  const handleDelete = async (asset: Asset) => {
    if (deletingIds.has(asset.id)) return;
    setDeletingIds(current => new Set(current).add(asset.id));
    try {
      await apiClient.delete(`/assets/${asset.id}`);
      setPendingDelete(null);
      setComparisonRevision(value => value + 1);
      await fetchAssets();
      toast('Asset deleted.', 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'Asset could not be deleted.'), 'error');
    } finally {
      setDeletingIds(current => { const next = new Set(current); next.delete(asset.id); return next; });
    }
  };

  const handleSave = async (data: AssetCreate) => {
    if (saving) return;
    setSaving(true);
    try {
      if (editAsset) await apiClient.put(`/assets/${editAsset.id}`, data);
      else await apiClient.post('/assets/', data);
      setShowModal(false);
      setComparisonRevision(value => value + 1);
      setEditAsset(null);
      await fetchAssets();
      toast(editAsset ? 'Asset updated.' : 'Asset created.', 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'Asset could not be saved.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Observe" title="Asset Inventory" description={`${total} managed IT, IoT, and OT assets with operational context.`} actions={
        <button
          disabled={criticalityBusy || showCriticalityReview} onClick={() => { setEditAsset(null); setShowModal(true); }}
          className="flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400"
        >
          <Plus className="w-4 h-4" />
          Add Asset
        </button>
      } />

      <AssetComparison ids={comparison} revision={comparisonRevision} />
      {comparison.length > 0 && <button type="button" className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-300" onClick={() => setComparison([])}>Clear asset comparison selection</button>}

      <fieldset disabled={criticalityBusy} className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            aria-label="Search assets"
            placeholder="Search assets..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          aria-label="Filter by asset type"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All types</option>
          {assetTypes.map(t => <option key={t} value={t}>{assetTypeLabel(t)}</option>)}
        </select>
        {vendorOptions.length > 0 && (
          <select
            aria-label="Filter by vendor"
            value={vendorFilter}
            onChange={(e) => { setVendorFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All vendors</option>
            {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <select
          aria-label="Filter by criticality"
          value={criticalityFilter}
          onChange={(e) => { setCriticalityFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All criticality</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          aria-label="Filter by OT or IT"
          value={otFilter}
          onChange={(e) => { setOtFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">OT and IT</option>
          <option value="true">OT only</option>
          <option value="false">IT only</option>
        </select>
        <select
          aria-label="Sort assets"
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="created_at_desc">Newest first</option>
          <option value="created_at_asc">Oldest first</option>
          <option value="name_asc">Name A-Z</option>
          <option value="name_desc">Name Z-A</option>
          <option value="criticality_desc">Highest criticality</option>
          <option value="criticality_asc">Lowest criticality</option>
          <option value="risk_desc">Highest risk</option>
        </select>
        <button
          type="button"
          onClick={() => { void exportCsv(); }}
          disabled={exporting}
          className="ml-auto flex items-center gap-2 px-3 py-2 bg-surface-800 hover:bg-surface-700 border border-surface-600 rounded-lg text-sm text-surface-200 transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </fieldset>

      {!loading && !error && assets.length > 0 && <button type="button" disabled={criticalityBusy || saving || !!deletingIds.size || showModal || !!pendingDelete} onClick={() => setShowCriticalityReview(value => !value)} className="rounded border border-surface-600 px-3 py-2 text-sm text-surface-200 disabled:opacity-40">{showCriticalityReview ? 'Hide criticality review' : 'Review page criticality'}</button>}
      {!loading && !error && showCriticalityReview && assets.length > 0 && <AssetCriticalityReview key={JSON.stringify([page, search, typeFilter, vendorFilter, criticalityFilter, otFilter, sort])} assets={assets} onBusy={setCriticalityBusy} onSaved={saved => { setComparisonRevision(value => value + 1); setAssets(current => current.map(asset => saved.has(asset.id) ? { ...asset, criticality: saved.get(asset.id)!, risk_score: undefined, risk_level: undefined } : asset)); }} />}
      {!loading && !error && showCriticalityReview && <button type="button" disabled={criticalityBusy} onClick={() => { setShowCriticalityReview(false); void fetchAssets(); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Refresh inventory after review</button>}

      {error ? <ErrorState title="Asset inventory unavailable" description={error} action={<RetryButton onClick={() => void fetchAssets()} />} /> : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full">
            <LoadingSurface rows={3} label="Loading asset inventory" />
          </div>
        ) : assets.length === 0 ? (
          <div className="col-span-full text-center py-12 text-surface-500">
            <Server className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>No assets found. Add your first asset to start monitoring.</p>
          </div>
        ) : (
          assets.map((asset) => (
            <div
              key={asset.id}
              className="oa-panel rounded-md p-4 hover:border-surface-600 transition-colors"
            >
              <label className="mb-3 flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" aria-label={`Select asset ${asset.id} for comparison`} checked={comparison.includes(asset.id)} disabled={comparison.length === 2 && !comparison.includes(asset.id)} onChange={event => setComparison(ids => event.target.checked ? [...ids, asset.id] : ids.filter(id => id !== asset.id))} />Select for comparison</label>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-surface-50"><button type="button" onClick={() => setInspectAssetId(asset.id)} aria-label={`View details for ${asset.name}`} className="max-w-full truncate text-left hover:text-primary-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">{asset.name}</button></h3>
                  <p className="text-xs text-surface-400 mt-1">{asset.vendor} {asset.product}</p>
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    disabled={criticalityBusy || showCriticalityReview} onClick={() => { setEditAsset(asset); setShowModal(true); }}
                    className="p-1.5 text-surface-500 hover:text-primary-400 transition-colors"
                    aria-label={`Edit ${asset.name}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => requestDelete(asset)}
                    disabled={criticalityBusy || showCriticalityReview || deletingIds.has(asset.id)}
                    className="p-1.5 text-surface-500 hover:text-danger transition-colors"
                    aria-label={`Delete ${asset.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge tone="neutral">{asset.asset_type}</StatusBadge>
                {asset.is_ot_asset && <StatusBadge tone="warning">OT</StatusBadge>}
                {asset.criticality && (
                  <StatusBadge tone={criticalityTones[asset.criticality] ?? 'neutral'}>{asset.criticality}</StatusBadge>
                )}
                {asset.risk_level && asset.risk_level !== 'none' && (
                  <StatusBadge tone={criticalityTones[asset.risk_level] ?? 'neutral'}>
                    Risk: {asset.risk_level}{typeof asset.risk_score === 'number' ? ` (${asset.risk_score})` : ''}
                  </StatusBadge>
                )}
              </div>
              {asset.version && (
                <p className="text-xs text-surface-500 mt-2">v{asset.version}</p>
              )}
              {typeof asset.open_alert_count === 'number' && (
                <div className="mt-2">
                  {asset.open_alert_count > 0 ? (
                    <Link
                      to={`/alerts?asset_id=${asset.id}`}
                      className="inline-flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                      {asset.open_alert_count} open alert{asset.open_alert_count === 1 ? '' : 's'}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-surface-500">
                      <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                      No open alerts
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>}

      {!loading && !error && total > 0 && <nav aria-label="Asset inventory pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p role="status" className="text-surface-400">Showing {(page - 1) * 15 + 1}–{Math.min(page * 15, total)} of {total} matching assets · Page {page} of {Math.ceil(total / 15)}</p>
        <div className="flex gap-2">
          <button type="button" disabled={criticalityBusy || page === 1} onClick={() => setPage(value => value - 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Previous assets</button>
          <button type="button" disabled={criticalityBusy || page * 15 >= total} onClick={() => setPage(value => value + 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Next assets</button>
        </div>
      </nav>}

      {inspectAssetId !== null && <AssetInspector key={inspectAssetId} assetId={inspectAssetId} onClose={() => setInspectAssetId(null)} />}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete asset?"
          description={`${pendingDelete.name} will be removed from the managed inventory. This cannot be undone.`}
          confirmLabel="Delete asset"
          tone="danger"
          busy={deletingIds.has(pendingDelete.id)}
          onCancel={() => { if (!deletingIds.has(pendingDelete.id)) setPendingDelete(null); }}
          onConfirm={() => { void handleDelete(pendingDelete); }}
        />
      )}

      {showModal && (
        <AssetModal
          asset={editAsset}
          assetTypes={assetTypes}
          onClose={() => { setShowModal(false); setEditAsset(null); }}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}

function AssetModal({ asset, assetTypes, onClose, onSave, saving }: { asset: Asset | null; assetTypes: string[]; onClose: () => void; onSave: (data: AssetCreate) => void; saving: boolean }) {
  const [form, setForm] = useState<AssetCreate>({
    name: asset?.name || '',
    asset_type: asset?.asset_type || 'hardware',
    vendor: asset?.vendor || '',
    product: asset?.product || '',
    version: asset?.version || '',
    description: asset?.description || '',
    is_ot_asset: asset?.is_ot_asset || false,
    network_zone: asset?.network_zone || '',
    criticality: asset?.criticality || 'medium',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!saving) onClose(); });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={onClose}></div>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="asset-dialog-title" className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]">
        <h2 id="asset-dialog-title" className="text-lg font-semibold text-surface-50 mb-4">{asset ? 'Edit Asset' : 'Add Asset'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text" aria-label="Asset name" placeholder="Name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text" aria-label="Vendor" placeholder="Vendor" value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
            <input
              type="text" aria-label="Product" placeholder="Product" value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
              className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <input
            type="text" aria-label="Version" placeholder="Version" value={form.version || ''}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <select
            aria-label="Asset type"
            value={form.asset_type}
            onChange={(e) => setForm({ ...form, asset_type: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {assetTypes.map(type => (
              <option key={type} value={type}>{assetTypeLabel(type)}</option>
            ))}
          </select>
          <select
            aria-label="Criticality"
            value={form.criticality || 'medium'}
            onChange={(e) => setForm({ ...form, criticality: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="low">Low Criticality</option>
            <option value="medium">Medium Criticality</option>
            <option value="high">High Criticality</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-surface-300">
            <input
              type="checkbox" checked={form.is_ot_asset || false}
              onChange={(e) => setForm({ ...form, is_ot_asset: e.target.checked })}
              className="rounded border-surface-600"
            />
            OT/ICS Asset
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded-lg text-sm transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-surface-950 rounded-lg text-sm font-medium transition-colors">
              {saving ? 'Saving…' : asset ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
