import { Fragment, useCallback, useEffect, useState } from 'react';
import apiClient from '../api/client';
import { Package, Trash2 } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/Toast';
import type { AssetListResponse } from '../api/types';

interface Sbom {
  id: number;
  asset_id: number;
  format: string;
  version: string | null;
  source: string;
  component_count: number;
  vulnerability_count: number;
  created_at: string;
}

interface SbomComponent {
  id: number;
  sbom_id: number;
  name: string;
  version: string | null;
  supplier: string | null;
  purl: string | null;
  cpe: string | null;
  license: string | null;
  has_known_vulnerability: number;
}

export function Sbom() {
  const [sboms, setSboms] = useState<Sbom[]>([]);
  const [assetNames, setAssetNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [components, setComponents] = useState<SbomComponent[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [componentsError, setComponentsError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Sbom | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSboms = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sbomRes, assetRes] = await Promise.all([
        apiClient.get<Sbom[]>('/sbom/'),
        apiClient.get<AssetListResponse>('/assets/', { params: { page: 1, size: 100 } }),
      ]);
      setSboms(sbomRes.data);
      setAssetNames(new Map(assetRes.data.assets.map(a => [a.id, a.name])));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Software bills of materials could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSboms(); }, [fetchSboms]);

  const toggleExpand = async (sbom: Sbom) => {
    if (expanded === sbom.id) { setExpanded(null); return; }
    setExpanded(sbom.id);
    setComponentsLoading(true);
    setComponentsError('');
    try {
      const res = await apiClient.get<SbomComponent[]>(`/sbom/${sbom.id}/components`);
      setComponents(res.data);
    } catch (err: unknown) {
      setComponents([]);
      setComponentsError(getApiErrorMessage(err, 'Components could not be loaded.'));
    } finally {
      setComponentsLoading(false);
    }
  };

  const handleDelete = async (sbom: Sbom) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/sbom/${sbom.id}`);
      setPendingDelete(null);
      if (expanded === sbom.id) setExpanded(null);
      await fetchSboms();
      toast('SBOM deleted.', 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'SBOM could not be deleted.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <LoadingSurface rows={4} label="Loading software bills of materials" />;
  if (error) return <ErrorState title="SBOM unavailable" description={error} action={<RetryButton onClick={() => void fetchSboms()} />} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Observe" title="Software Bill of Materials" description="Component inventory and known-vulnerability exposure per asset." />

      {sboms.length === 0 ? (
        <div className="oa-panel p-12 text-center text-surface-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No SBOMs uploaded yet.</p>
        </div>
      ) : (
        <div className="oa-panel overflow-hidden rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-400">
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Format</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Components</th>
                <th className="px-4 py-3 text-left">Vulnerabilities</th>
                <th className="px-4 py-3 text-left">Uploaded</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sboms.map(sbom => (
                <Fragment key={sbom.id}>
                  <tr
                    onClick={() => void toggleExpand(sbom)}
                    className="cursor-pointer border-b border-surface-700/50 hover:bg-surface-800 transition-colors"
                  >
                    <td className="px-4 py-3 text-surface-200 font-medium">{assetNames.get(sbom.asset_id) ?? `Asset #${sbom.asset_id}`}</td>
                    <td className="px-4 py-3 text-surface-400 text-xs">{sbom.format}{sbom.version ? ` ${sbom.version}` : ''}</td>
                    <td className="px-4 py-3 text-surface-400 text-xs">{sbom.source}</td>
                    <td className="px-4 py-3 text-surface-300">{sbom.component_count}</td>
                    <td className="px-4 py-3">
                      {sbom.vulnerability_count > 0 ? (
                        <StatusBadge tone="danger">{sbom.vulnerability_count}</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">0</StatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-surface-500 text-xs">{new Date(sbom.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(sbom); }}
                        aria-label={`Delete SBOM for ${assetNames.get(sbom.asset_id) ?? `asset ${sbom.asset_id}`}`}
                        className="p-1.5 text-surface-500 hover:text-danger transition-colors"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  {expanded === sbom.id && (
                    <tr className="border-b border-surface-700/50 bg-surface-900/60">
                      <td colSpan={7} className="px-6 py-4">
                        {componentsLoading ? (
                          <LoadingSurface rows={2} label="Loading components" />
                        ) : componentsError ? (
                          <ErrorState title="Components unavailable" description={componentsError} action={<RetryButton onClick={() => void toggleExpand(sbom)} />} />
                        ) : components.length === 0 ? (
                          <p className="text-sm text-surface-500">No components in this SBOM.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-surface-500 text-xs">
                                <th className="py-1.5 text-left">Component</th>
                                <th className="py-1.5 text-left">Version</th>
                                <th className="py-1.5 text-left">Supplier</th>
                                <th className="py-1.5 text-left">License</th>
                                <th className="py-1.5 text-left">Known vulnerabilities</th>
                              </tr>
                            </thead>
                            <tbody>
                              {components.map(component => (
                                <tr key={component.id} className="border-t border-surface-700/40">
                                  <td className="py-1.5 text-surface-200">{component.name}</td>
                                  <td className="py-1.5 text-surface-400 text-xs">{component.version ?? '-'}</td>
                                  <td className="py-1.5 text-surface-400 text-xs">{component.supplier ?? '-'}</td>
                                  <td className="py-1.5 text-surface-400 text-xs">{component.license ?? '-'}</td>
                                  <td className="py-1.5">
                                    {component.has_known_vulnerability ? (
                                      <StatusBadge tone="danger">Yes</StatusBadge>
                                    ) : (
                                      <span className="text-xs text-surface-500">None</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete SBOM?"
          description={`The SBOM for ${assetNames.get(pendingDelete.asset_id) ?? `asset ${pendingDelete.asset_id}`} and its component inventory will be removed. This cannot be undone.`}
          confirmLabel="Delete SBOM"
          tone="danger"
          busy={deleting}
          onCancel={() => { if (!deleting) setPendingDelete(null); }}
          onConfirm={() => { void handleDelete(pendingDelete); }}
        />
      )}
    </div>
  );
}
