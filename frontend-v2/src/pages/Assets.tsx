import { useEffect, useState, useCallback } from 'react';
import apiClient from '../api/client';
import type { Asset, AssetCreate, AssetListResponse } from '../api/types';
import { Plus, Search, Server, Trash2, Edit2 } from 'lucide-react';
import clsx from 'clsx';

export function Assets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, size: 15 };
      if (search) params.search = search;
      const res = await apiClient.get<AssetListResponse>('/assets/', { params });
      setAssets(res.data.assets);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to fetch assets:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this asset?')) return;
    await apiClient.delete(`/assets/${id}`);
    fetchAssets();
  };

  const handleSave = async (data: AssetCreate) => {
    if (editAsset) {
      await apiClient.put(`/assets/${editAsset.id}`, data);
    } else {
      await apiClient.post('/assets/', data);
    }
    setShowModal(false);
    setEditAsset(null);
    fetchAssets();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Assets</h1>
          <p className="text-surface-400 mt-1">{total} monitored assets</p>
        </div>
        <button
          onClick={() => { setEditAsset(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Asset
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
        <input
          type="text"
          placeholder="Search assets..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-400"></div>
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
              className="bg-surface-800/50 border border-surface-700 rounded-xl p-4 hover:border-surface-600 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-white truncate">{asset.name}</h3>
                  <p className="text-xs text-surface-400 mt-1">{asset.vendor} {asset.product}</p>
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={() => { setEditAsset(asset); setShowModal(true); }}
                    className="p-1.5 text-surface-500 hover:text-primary-400 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(asset.id)}
                    className="p-1.5 text-surface-500 hover:text-danger transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="px-2 py-0.5 bg-surface-700 rounded text-xs text-surface-300">
                  {asset.asset_type}
                </span>
                {asset.is_ot_asset && (
                  <span className="px-2 py-0.5 bg-warning/10 text-warning border border-warning/20 rounded text-xs">
                    OT
                  </span>
                )}
                {asset.criticality && (
                  <span className={clsx(
                    'px-2 py-0.5 rounded text-xs border',
                    asset.criticality === 'high' ? 'bg-danger/10 text-danger border-danger/20' :
                    asset.criticality === 'medium' ? 'bg-warning/10 text-warning border-warning/20' :
                    'bg-success/10 text-success border-success/20'
                  )}>
                    {asset.criticality}
                  </span>
                )}
              </div>
              {asset.version && (
                <p className="text-xs text-surface-500 mt-2">v{asset.version}</p>
              )}
            </div>
          ))
        )}
      </div>

      {showModal && (
        <AssetModal
          asset={editAsset}
          onClose={() => { setShowModal(false); setEditAsset(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function AssetModal({ asset, onClose, onSave }: { asset: Asset | null; onClose: () => void; onSave: (data: AssetCreate) => void }) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}></div>
      <div className="relative bg-surface-900 border border-surface-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-white mb-4">{asset ? 'Edit Asset' : 'Add Asset'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text" placeholder="Name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text" placeholder="Vendor" value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
            <input
              type="text" placeholder="Product" value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
              className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <input
            type="text" placeholder="Version" value={form.version || ''}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <select
            value={form.asset_type}
            onChange={(e) => setForm({ ...form, asset_type: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="hardware">Hardware</option>
            <option value="software">Software</option>
            <option value="firmware">Firmware</option>
            <option value="plc">PLC</option>
            <option value="hmi">HMI</option>
            <option value="scada">SCADA</option>
            <option value="rtu">RTU</option>
            <option value="network_device">Network Device</option>
            <option value="other_ot">Other OT</option>
          </select>
          <select
            value={form.criticality || 'medium'}
            onChange={(e) => setForm({ ...form, criticality: e.target.value })}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
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
            <button type="submit" className="flex-1 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors">
              {asset ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
