import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';
import { Download, Package, Trash2, Upload } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/Toast';
import type { Asset, AssetListResponse } from '../api/types';
import { useDialogFocus } from '../components/ui/useDialogFocus';

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

const COPYLEFT_RE = /gpl|sspl|cddl|epl|eupl|cc-by-sa/i;

export function Sbom() {
  const [sboms, setSboms] = useState<Sbom[]>([]);
  const [assetNames, setAssetNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const componentRequestId = useRef(0);
  const [components, setComponents] = useState<SbomComponent[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [componentsError, setComponentsError] = useState('');
  const [exportingId, setExportingId] = useState<number | null>(null);

  const exportComponents = async (sbom: Sbom) => {
    if (exportingId !== null) return;
    setExportingId(sbom.id);
    try {
      const res = await apiClient.get(`/sbom/${sbom.id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sbom-${sbom.id}-components.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The export could not be downloaded.'), 'error');
    } finally {
      setExportingId(null);
    }
  };
  const licenseSummary = useMemo(() => {
    if (components.length === 0) return null;
    const counts = new Map<string, number>();
    let licensed = 0;
    let copyleft = 0;
    for (const c of components) {
      const name = (c.license ?? '').trim();
      if (!name) continue;
      licensed += 1;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (COPYLEFT_RE.test(name)) copyleft += 1;
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { licensed, copyleft, top };
  }, [components]);

  const [componentSearch, setComponentSearch] = useState('');
  const [vulnerableOnly, setVulnerableOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Sbom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetTotal, setAssetTotal] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const componentQuery = componentSearch.trim().toLowerCase();
  const searchedComponents = componentQuery
    ? components.filter(c =>
        c.name.toLowerCase().includes(componentQuery)
        || (c.version ?? '').toLowerCase().includes(componentQuery)
        || (c.supplier ?? '').toLowerCase().includes(componentQuery)
      )
    : components;
  const visibleComponents = vulnerableOnly
    ? searchedComponents.filter(c => c.has_known_vulnerability > 0)
    : searchedComponents;
  const [uploading, setUploading] = useState(false);

  const fetchSboms = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sbomRes, assetRes] = await Promise.all([
        apiClient.get<Sbom[]>('/sbom/'),
        apiClient.get<AssetListResponse>('/assets/', { params: { page: 1, size: 100 } }),
      ]);
      setSboms(sbomRes.data);
      setAssets(assetRes.data.assets);
      setAssetTotal(assetRes.data.total);
      setAssetNames(new Map(assetRes.data.assets.map(a => [a.id, a.name])));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Software bills of materials could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSboms(); return () => { componentRequestId.current += 1; }; }, [fetchSboms]);

  const toggleExpand = async (sbom: Sbom) => {
    const request = ++componentRequestId.current;
    if (expanded === sbom.id) { setExpanded(null); return; }
    setExpanded(sbom.id);
    setComponentSearch('');
    setVulnerableOnly(false);
    setComponents([]);
    setComponentsLoading(true);
    setComponentsError('');
    try {
      const res = await apiClient.get<SbomComponent[]>(`/sbom/${sbom.id}/components`);
      if (request !== componentRequestId.current) return;
      setComponents(res.data);
    } catch (err: unknown) {
      if (request !== componentRequestId.current) return;
      setComponents([]);
      setComponentsError(getApiErrorMessage(err, 'Components could not be loaded.'));
    } finally {
      if (request === componentRequestId.current) setComponentsLoading(false);
    }
  };

  const handleDelete = async (sbom: Sbom) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/sbom/${sbom.id}`);
      setPendingDelete(null);
      if (expanded === sbom.id) { componentRequestId.current += 1; setExpanded(null); }
      await fetchSboms();
      toast('SBOM deleted.', 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'SBOM could not be deleted.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleUpload = async (assetId: number, sbomData: Record<string, unknown>) => {
    if (uploading) return;
    setUploading(true);
    try {
      await apiClient.post('/sbom/upload', { asset_id: assetId, sbom_data: sbomData, source: 'upload' });
      setShowUpload(false);
      await fetchSboms();
      toast('SBOM uploaded.', 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'SBOM could not be uploaded. Check that the document is CycloneDX or SPDX JSON.'), 'error');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <LoadingSurface rows={4} label="Loading software bills of materials" />;
  if (error) return <ErrorState title="SBOM unavailable" description={error} action={<RetryButton onClick={() => void fetchSboms()} />} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Observe" title="Software Bill of Materials" description="Component inventory and known-vulnerability exposure per asset." actions={
        <button
          onClick={() => setShowUpload(true)}
          className="flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400"
        >
          <Upload className="w-4 h-4" aria-hidden="true" />
          Upload SBOM
        </button>
      } />

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
                          <div>
                            {licenseSummary && licenseSummary.top.length > 0 && (
                              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" aria-label="License summary">
                                <span className="text-surface-400">{licenseSummary.licensed} of {components.length} components licensed</span>
                                {licenseSummary.top.slice(0, 5).map(([name, count]) => (
                                  <span key={name} className="rounded-full border border-surface-600 bg-surface-800 px-2 py-0.5 text-surface-300">{name} · {count}</span>
                                ))}
                                {licenseSummary.top.length > 5 && <span className="text-surface-500">+{licenseSummary.top.length - 5} more</span>}
                                {licenseSummary.copyleft > 0 && <StatusBadge tone="warning">{licenseSummary.copyleft} copyleft</StatusBadge>}
                              </div>
                            )}
                            <div className="mb-3 flex items-center gap-3">
                              <input
                                type="text"
                                aria-label="Search components"
                                placeholder="Search components..."
                                value={componentSearch}
                                onChange={(e) => setComponentSearch(e.target.value)}
                                className="w-64 px-3 py-1.5 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                              <label className="flex items-center gap-2 text-xs text-surface-300">
                                <input
                                  type="checkbox"
                                  checked={vulnerableOnly}
                                  onChange={(e) => setVulnerableOnly(e.target.checked)}
                                  className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
                                />
                                Vulnerable only
                              </label>
                              <span className="text-xs text-surface-500">{visibleComponents.length} of {components.length} components</span>
                              <button
                                type="button"
                                onClick={() => { void exportComponents(sbom); }}
                                disabled={exportingId === sbom.id}
                                className="ml-auto flex items-center gap-1.5 rounded-md border border-surface-600 px-2.5 py-1 text-xs text-surface-200 hover:border-primary-500 hover:text-primary-300 disabled:opacity-50"
                              >
                                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                {exportingId === sbom.id ? 'Exporting...' : 'Export CSV'}
                              </button>
                            </div>
                            {visibleComponents.length === 0 ? (
                              <p className="text-sm text-surface-500">No components match the current filters.</p>
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
                              {visibleComponents.map(component => (
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
                          </div>
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

      {showUpload && (
        <UploadDialog
          assets={assets}
          totalAssets={assetTotal}
          uploading={uploading}
          onClose={() => { if (!uploading) setShowUpload(false); }}
          onUpload={handleUpload}
        />
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

function UploadDialog({ assets, totalAssets, uploading, onClose, onUpload }: {
  assets: Asset[];
  totalAssets: number;
  uploading: boolean;
  onClose: () => void;
  onUpload: (assetId: number, sbomData: Record<string, unknown>) => void;
}) {
  const [assetId, setAssetId] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [options, setOptions] = useState(assets);
  const [optionTotal, setOptionTotal] = useState(totalAssets);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [retry, setRetry] = useState(0);
  const initialOptions = useRef(true);
  useEffect(() => {
    if (initialOptions.current) { initialOptions.current = false; return; }
    let active = true;
    setOptionsLoading(true); setOptionsError('');
    void apiClient.get<AssetListResponse>('/assets/', { params: { page, size: 100, ...(search ? { search } : {}) } }).then(res => {
      if (!active) return;
      const lastPage = Math.max(1, Math.ceil(res.data.total / 100));
      if (page > lastPage) { setPage(lastPage); return; }
      setOptions(res.data.assets); setOptionTotal(res.data.total);
    }).catch(err => { if (active) setOptionsError(getApiErrorMessage(err, 'Destination assets could not be loaded.')); })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [page, search, retry]);
  const [document, setDocument] = useState('');
  const [parseError, setParseError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!uploading) onClose(); });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading || !selectedAsset || optionsLoading || optionsError) return;
    setParseError('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      setParseError('That is not valid JSON. Paste a CycloneDX or SPDX document.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || (!('bomFormat' in parsed) && !('spdxVersion' in parsed))) {
      setParseError('The document needs a bomFormat (CycloneDX) or spdxVersion (SPDX) key.');
      return;
    }
    onUpload(Number(assetId), parsed as Record<string, unknown>);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={() => { if (!uploading) onClose(); }}></div>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sbom-upload-title" className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]">
        <h2 id="sbom-upload-title" className="text-lg font-semibold text-surface-50 mb-4">Upload SBOM</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2 rounded-md border border-surface-700 p-3">
            <label htmlFor="sbom-asset-search" className="text-xs text-surface-300">Find destination asset</label>
            <div className="flex gap-2"><input id="sbom-asset-search" value={query} disabled={uploading} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 rounded border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-surface-100" placeholder="Name, vendor or product" /><button type="button" disabled={uploading} onClick={() => { setPage(1); setSearch(query.trim()); setRetry(value => value + 1); }} className="rounded border border-surface-600 px-3 text-xs text-surface-200">Search assets</button></div>
            {optionsLoading ? <p role="status" className="text-xs text-surface-400">Loading destination assets...</p> : optionsError ? <div><p role="alert" className="text-xs text-danger">{optionsError}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 text-xs text-primary-400">Retry destination assets</button></div> : <>
          <select
            aria-label="Asset"
            value={assetId}
            onChange={(e) => { setAssetId(e.target.value); setSelectedAsset(options.find(asset => String(asset.id) === e.target.value) || selectedAsset); }}
            disabled={uploading}
            required
            className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="" disabled>Select an asset</option>
            {selectedAsset && !options.some(asset => asset.id === selectedAsset.id) && <option value={selectedAsset.id}>{selectedAsset.name} (selected)</option>}
            {options.map(asset => (
              <option key={asset.id} value={asset.id}>{asset.name} · #{asset.id}</option>
            ))}
          </select>
            <p className="text-xs text-surface-400">{optionTotal === 0 ? 'No matching destination assets.' : `Showing ${(page - 1) * 100 + 1}–${Math.min(page * 100, optionTotal)} of ${optionTotal} matching assets · Page ${page} of ${Math.ceil(optionTotal / 100)}`}</p>
            <div className="flex gap-2"><button type="button" disabled={uploading || page === 1} onClick={() => setPage(value => value - 1)} className="rounded border border-surface-600 px-2 py-1 text-xs text-surface-200 disabled:opacity-40">Previous assets</button><button type="button" disabled={uploading || page * 100 >= optionTotal} onClick={() => setPage(value => value + 1)} className="rounded border border-surface-600 px-2 py-1 text-xs text-surface-200 disabled:opacity-40">More assets</button></div>
            </>}
            <p className="break-words text-xs text-surface-300">{selectedAsset ? `Selected destination: ${selectedAsset.name} (#${selectedAsset.id}). Search and page changes keep this selection until you choose another asset.` : 'Choose a destination asset before uploading.'}</p>
          </div>
          <textarea
            aria-label="SBOM JSON document"
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            placeholder='{"bomFormat": "CycloneDX", "specVersion": "1.5", ...}'
            rows={10}
            required
            className="w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 font-mono text-xs text-surface-50 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {parseError && <p role="alert" className="text-xs text-danger">{parseError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="rounded px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-800 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !selectedAsset || optionsLoading || !!optionsError}
              className="rounded-md bg-primary-500 px-3.5 py-1.5 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-40"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
