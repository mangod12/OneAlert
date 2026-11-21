import { useSearchParams } from 'react-router-dom';
import { SbomRecordInspector } from '../components/SbomRecordInspector';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';
import { Download, Package, Trash2, Upload } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/Toast';
import type { Asset, AssetListResponse } from '../api/types';
import { inspectSbomDocument, MAX_SBOM_BYTES } from '../utils/sbomImport';
import { SbomComparison } from '../components/SbomComparison';
import { componentEvidenceCsv, componentEvidenceJson, evidenceGapCounts, evidenceGapLabels, hasEvidenceGap, hasRecordedValue, type EvidenceGap, type EvidenceSnapshot } from '../utils/sbomEvidence';
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
  hash_sha256?: string | null;
  has_known_vulnerability: number;
}

const COPYLEFT_RE = /gpl|sspl|cddl|epl|eupl|cc-by-sa/i;

export function Sbom() {
  const [searchParams, setSearchParams] = useSearchParams();
  const documentValues = searchParams.getAll('sbom');
  const documentValue = documentValues.length === 1 ? documentValues[0] : '';
  const exactDocumentId = /^[1-9][0-9]*$/.test(documentValue) && Number.isSafeInteger(Number(documentValue)) ? Number(documentValue) : null;
  const componentValues = searchParams.getAll('component');
  const componentValue = componentValues.length === 1 ? componentValues[0] : '';
  const exactComponentId = /^[1-9][0-9]*$/.test(componentValue) && Number(componentValue) <= 2147483647 ? Number(componentValue) : null;
  const invalidComponentLink = componentValues.length > 0 && (exactComponentId === null || exactDocumentId === null);
  const invalidDocumentLink = documentValues.length > 0 && exactDocumentId === null;
  const inspectDocument = (id: number | null) => setSearchParams(current => { const next = new URLSearchParams(current); next.delete('component'); if (id === null) next.delete('sbom'); else next.set('sbom', String(id)); return next; }, { replace: id === null });
  const listRequestId = useRef(0);
  const [assetNamesError, setAssetNamesError] = useState('');
  const [sboms, setSboms] = useState<Sbom[]>([]);
  const [assetNames, setAssetNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [componentEvidence, setComponentEvidence] = useState<{ component: SbomComponent; sbom: Sbom } | null>(null);
  const [comparison, setComparison] = useState<Sbom | null>(null);
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
      if (!hasRecordedValue(name)) continue;
      licensed += 1;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (COPYLEFT_RE.test(name)) copyleft += 1;
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { licensed, copyleft, top };
  }, [components]);

  const [componentSearch, setComponentSearch] = useState('');
  const [vulnerableOnly, setVulnerableOnly] = useState(false);
  const [evidenceGap, setEvidenceGap] = useState<EvidenceGap>('');
  const completeness = useMemo(() => evidenceGapCounts(components), [components]);
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
        || (c.purl ?? '').toLowerCase().includes(componentQuery)
        || (c.cpe ?? '').toLowerCase().includes(componentQuery)
        || (c.license ?? '').toLowerCase().includes(componentQuery)
        || (c.hash_sha256 ?? '').toLowerCase().includes(componentQuery)
      )
    : components;
  const vulnerabilityFiltered = vulnerableOnly ? searchedComponents.filter(c => c.has_known_vulnerability > 0) : searchedComponents;
  const visibleComponents = vulnerabilityFiltered.filter(component => hasEvidenceGap(component, evidenceGap));
  const [uploading, setUploading] = useState(false);

  const fetchSboms = useCallback(async () => {
    const request = ++listRequestId.current;
    setLoading(true); setError(''); setAssetNamesError('');
    const [sbomResult, assetResult] = await Promise.allSettled([
      apiClient.get<Sbom[]>('/sbom/'),
      apiClient.get<AssetListResponse>('/assets/', { params: { page: 1, size: 100 } }),
    ]);
    if (request !== listRequestId.current) return;
    if (sbomResult.status === 'fulfilled') setSboms(sbomResult.value.data);
    else { setSboms([]); setError(getApiErrorMessage(sbomResult.reason, 'Software bills of materials could not be loaded.')); }
    if (assetResult.status === 'fulfilled') {
      setAssets(assetResult.value.data.assets);
      setAssetTotal(assetResult.value.data.total);
      setAssetNames(new Map(assetResult.value.data.assets.map(asset => [asset.id, asset.name])));
    } else {
      setAssets([]); setAssetTotal(0); setAssetNames(new Map());
      setAssetNamesError(getApiErrorMessage(assetResult.reason, 'Asset names are unavailable. SBOMs are shown by asset ID.'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchSboms();
    return () => { componentRequestId.current += 1; listRequestId.current += 1; };
  }, [fetchSboms]);

  const toggleExpand = async (sbom: Sbom) => {
    const request = ++componentRequestId.current;
    if (expanded === sbom.id) { setExpanded(null); return; }
    setExpanded(sbom.id);
    setComponentSearch('');
    setVulnerableOnly(false);
    setEvidenceGap('');
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

  const downloadEvidence = (sbom: Sbom, format: 'json' | 'csv') => {
    try {
      const snapshot: EvidenceSnapshot = { sbom: { id: sbom.id, asset_id: sbom.asset_id, format: sbom.format, version: sbom.version, source: sbom.source, created_at: sbom.created_at, component_count: sbom.component_count }, components: visibleComponents, loadedCount: components.length, filters: { search: componentSearch.trim(), recordedVulnerabilitiesOnly: vulnerableOnly, evidenceGap }, exportedAt: new Date().toISOString() };
      const body = format === 'json' ? componentEvidenceJson(snapshot) : componentEvidenceCsv(snapshot);
      const url = URL.createObjectURL(new Blob([body], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `sbom-${sbom.id}-matching-evidence.${format}`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast('Matching component evidence could not be downloaded. The loaded records remain available.', 'error'); }
  };

  const handleDelete = async (sbom: Sbom) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/sbom/${sbom.id}`);
      setPendingDelete(null);
      if (comparison?.id === sbom.id) setComparison(null);
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

  const recordPanel = <>
      {invalidDocumentLink && <p role="alert" className="text-sm text-warning">This SBOM link needs exactly one positive document ID. No document was opened. <button type="button" onClick={() => inspectDocument(null)} className="ml-2 text-primary-300">Clear invalid SBOM link</button></p>}
      {invalidComponentLink && <p role="alert" className="text-sm text-warning">This component link needs one exact positive component ID and its SBOM document ID. No component or document was opened. <button type="button" onClick={() => inspectDocument(null)} className="text-primary-300">Clear invalid component link</button></p>}
      {exactDocumentId !== null && !invalidComponentLink && <SbomRecordInspector key={`${exactDocumentId}:${exactComponentId}`} sbomId={exactDocumentId} componentId={exactComponentId ?? undefined} onBrowseDocument={() => inspectDocument(exactDocumentId)} onClose={() => inspectDocument(null)} />}
  </>;

  if (loading) return <>{recordPanel}<LoadingSurface rows={4} label="Loading software bills of materials" /></>;
  if (error) return <>{recordPanel}<ErrorState title="SBOM unavailable" description={error} action={<RetryButton onClick={() => void fetchSboms()} />} /></>;

  return (
    <div className="space-y-6">
      {recordPanel}
      <a href="/app/sbom/documents" className="inline-block text-sm text-primary-300">Search the full document library</a>
      <a href="/app/sbom/components" className="inline-block text-sm text-primary-300">Find recorded components across assets</a>
      {assetNamesError && <DegradedBanner messages={[assetNamesError, 'SBOM records remain available by asset ID.']} onRetry={() => void fetchSboms()} />}
      <PageHeader eyebrow="Observe" title="Software Bill of Materials" description="Recorded component inventory, evidence completeness and vulnerability references per asset." actions={
        <button
          onClick={() => setShowUpload(true)}
          className="flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400"
        >
          <Upload className="w-4 h-4" aria-hidden="true" />
          Upload SBOM
        </button>
      } />

      {comparison && <SbomComparison key={comparison.id} current={comparison} snapshots={sboms} onClose={() => setComparison(null)} />}

      {sboms.length === 0 ? (
        <div className="oa-panel p-12 text-center text-surface-500">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No SBOMs uploaded yet.</p>
        </div>
      ) : (
        <div role="region" aria-label="SBOM inventory and component evidence" tabIndex={0} className="oa-panel overflow-x-auto rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-400">
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Format</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Components</th>
                <th className="px-4 py-3 text-left">Recorded vulnerability IDs</th>
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
                    <td className="px-4 py-3 text-surface-200 font-medium"><button type="button" aria-expanded={expanded === sbom.id} onClick={event => { event.stopPropagation(); void toggleExpand(sbom); }} className="rounded text-left hover:text-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500">{assetNames.get(sbom.asset_id) ?? `Asset #${sbom.asset_id}`}</button></td>
                    <td className="px-4 py-3 text-surface-400 text-xs">{sbom.format}{sbom.version ? ` ${sbom.version}` : ''}</td>
                    <td className="px-4 py-3 text-surface-400 text-xs">{sbom.source}</td>
                    <td className="px-4 py-3 text-surface-300">{sbom.component_count}</td>
                    <td className="px-4 py-3">
                      {sbom.vulnerability_count > 0 ? (
                        <StatusBadge tone="danger">{sbom.vulnerability_count}</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">0 recorded</StatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-surface-500 text-xs">{new Date(sbom.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" aria-label={`Open exact SBOM ${sbom.id}`} onClick={event => { event.stopPropagation(); inspectDocument(sbom.id); }} className="mr-2 rounded border border-surface-600 px-2 py-1 text-xs text-primary-300">Exact record</button>
                      <button type="button" aria-label={`Compare SBOM ${sbom.id}`} onClick={event => { event.stopPropagation(); setComparison(sbom); }} className="mr-2 rounded border border-surface-600 px-2 py-1 text-xs text-primary-300">Compare</button>
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
                          <div className="w-[calc(100vw-5rem)] lg:w-full">
                            <section aria-label="Component evidence completeness" className="mb-4 space-y-3 rounded border border-surface-700 p-3">
                              <h3 className="text-sm font-semibold text-surface-100">Recorded evidence completeness</h3>
                              <p className="max-w-2xl text-xs text-surface-400">Loaded {components.length} component records; SBOM summary records {sbom.component_count}. Missing evidence is not proof of risk or safety. Counts cover loaded records, not a live scan, verified package hashes or legal license review.</p>
                              <div className="flex flex-wrap gap-2">{(Object.entries(evidenceGapLabels) as [Exclude<EvidenceGap, ''>, string][]).map(([gap, label]) => <button type="button" key={gap} aria-pressed={evidenceGap === gap} onClick={() => setEvidenceGap(current => current === gap ? '' : gap)} className={`rounded border px-3 py-2 text-left text-xs ${evidenceGap === gap ? 'border-primary-400 bg-primary-500/10 text-primary-200' : 'border-surface-600 text-surface-300'}`}>{label}: {completeness[gap]}</button>)}</div>
                              {evidenceGap && <p className="text-xs text-surface-300">Applied evidence gap: {evidenceGapLabels[evidenceGap]}. Search and recorded vulnerability filters still apply. <button type="button" onClick={() => setEvidenceGap('')} className="text-primary-300">Clear evidence gap</button></p>}
                              <div className="flex flex-wrap gap-2"><button type="button" onClick={() => downloadEvidence(sbom, 'csv')} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Export matching CSV</button><button type="button" onClick={() => downloadEvidence(sbom, 'json')} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Download matching evidence JSON</button></div>
                              <p className="text-xs text-surface-400">Matching downloads include only the {visibleComponents.length} shown records from this loaded snapshot. JSON also records filters and counts. No additional server request or rescanning is performed.</p>
                            </section>
                            {licenseSummary && licenseSummary.top.length > 0 && (
                              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" aria-label="License summary">
                                <span className="text-surface-400">{licenseSummary.licensed} of {components.length} with recorded license text</span>
                                {licenseSummary.top.slice(0, 5).map(([name, count]) => (
                                  <span key={name} className="rounded-full border border-surface-600 bg-surface-800 px-2 py-0.5 text-surface-300">{name} · {count}</span>
                                ))}
                                {licenseSummary.top.length > 5 && <span className="text-surface-500">+{licenseSummary.top.length - 5} more</span>}
                                {licenseSummary.copyleft > 0 && <StatusBadge tone="warning">{licenseSummary.copyleft} copyleft-like labels</StatusBadge>}
                              </div>
                            )}
                            <div className="mb-3 flex flex-wrap items-center gap-3">
                              <input
                                type="text"
                                aria-label="Search components"
                                placeholder="Name, package URL, CPE, license..."
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
                                Recorded vulnerability references only
                              </label>
                              <span className="text-xs text-surface-500">{visibleComponents.length} of {components.length} components</span>
                              <button
                                type="button"
                                onClick={() => { void exportComponents(sbom); }}
                                disabled={exportingId === sbom.id}
                                className="ml-auto flex items-center gap-1.5 rounded-md border border-surface-600 px-2.5 py-1 text-xs text-surface-200 hover:border-primary-500 hover:text-primary-300 disabled:opacity-50"
                              >
                                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                {exportingId === sbom.id ? 'Exporting...' : 'Export all CSV'}
                              </button>
                            </div>
                            {visibleComponents.length === 0 ? (
                              <p className="text-sm text-surface-500">No components match the current filters.</p>
                            ) : (
                          <div><p className="mb-2 text-xs text-surface-400 lg:hidden">Scroll component rows horizontally to review all recorded fields.</p><div role="region" aria-label="Recorded component rows" tabIndex={0} className="overflow-x-auto"><table className="min-w-[44rem] w-full text-sm">
                            <thead>
                              <tr className="text-surface-500 text-xs">
                                <th className="py-1.5 text-left">Component</th>
                                <th className="py-1.5 text-left">Version</th>
                                <th className="py-1.5 text-left">Supplier</th>
                                <th className="py-1.5 text-left">License</th>
                                <th className="py-1.5 text-left">Recorded vulnerability references</th>
                                <th className="py-1.5 text-right">Evidence</th>
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
                                      <StatusBadge tone="danger">{component.has_known_vulnerability} recorded</StatusBadge>
                                    ) : (
                                      <span className="text-xs text-surface-500">0 recorded, not scanned</span>
                                    )}
                                  </td>
                                  <td className="py-1.5 text-right"><button type="button" aria-label={`View evidence for ${component.name}`} onClick={() => setComponentEvidence({ component, sbom })} className="whitespace-nowrap rounded border border-surface-600 px-2 py-1 text-xs text-primary-300 hover:border-primary-500">View evidence</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table></div></div>
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

      {componentEvidence && <ComponentEvidenceDialog component={componentEvidence.component} sbom={componentEvidence.sbom} assetName={assetNames.get(componentEvidence.sbom.asset_id)} onClose={() => setComponentEvidence(null)} />}

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
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const fileRequest = useRef(0);
  const readerRef = useRef<FileReader | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { fileRequest.current += 1; readerRef.current?.abort(); }, []);
  const preview = useMemo(() => {
    if (!document.trim()) return { prepared: null, error: '' };
    try { return { prepared: inspectSbomDocument(document), error: '' }; }
    catch (err) { return { prepared: null, error: err instanceof Error ? err.message : 'The document could not be read.' }; }
  }, [document]);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!uploading) onClose(); });

  const readFile = (file: File | undefined) => {
    if (!file || uploading) return;
    const request = ++fileRequest.current;
    readerRef.current?.abort();
    setDocument(''); setFileName(file.name); setFileError(''); setReadingFile(false);
    if (file.size > MAX_SBOM_BYTES) { setFileError('Choose a JSON document no larger than 5 MiB for this importer.'); return; }
    setReadingFile(true);
    const reader = new FileReader();
    readerRef.current = reader;
    reader.onload = () => {
      if (request !== fileRequest.current) return;
      const text = typeof reader.result === 'string' ? reader.result : '';
      setDocument(text); setFileError(text.trim() ? '' : 'The local file is empty. Choose a JSON document.'); setReadingFile(false);
    };
    reader.onerror = () => {
      if (request !== fileRequest.current) return;
      setFileError('The local file could not be read. Choose it again or paste its JSON.'); setReadingFile(false);
    };
    reader.readAsText(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading || readingFile || !selectedAsset || optionsLoading || optionsError || !preview.prepared) return;
    onUpload(Number(assetId), preview.prepared.document);
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
          <div className="space-y-2 rounded-md border border-surface-700 p-3">
            <label htmlFor="sbom-local-file" className="block text-xs text-surface-200">Choose local SBOM JSON file</label>
            <input ref={fileInputRef} id="sbom-local-file" type="file" accept=".json,application/json" disabled={uploading}
              onChange={event => readFile(event.target.files?.[0])}
              className="block w-full min-w-0 text-xs text-surface-300 file:mr-3 file:rounded file:border-0 file:bg-surface-700 file:px-3 file:py-2 file:text-surface-100" />
            <p className="text-xs text-surface-400">Up to 5 MiB. The file stays in your browser until you choose Upload. You can also paste or edit JSON below.</p>
            {readingFile && <p role="status" className="text-xs text-surface-300">Reading local file...</p>}
            {fileName && <p className="break-all text-xs text-surface-300">Local file: {fileName}</p>}
          </div>
          <textarea
            aria-label="SBOM JSON document"
            value={document}
            onChange={(e) => { fileRequest.current += 1; readerRef.current?.abort(); if (fileInputRef.current) fileInputRef.current.value = ''; setReadingFile(false); setFileName(''); setFileError(''); setDocument(e.target.value); }}
            disabled={uploading}
            placeholder='{"bomFormat": "CycloneDX", "specVersion": "1.5", ...}'
            rows={10}
            required
            className="w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 font-mono text-xs text-surface-50 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {(fileError || preview.error) && <p role="alert" className="text-xs text-danger">{fileError || preview.error}</p>}
          {preview.prepared && !readingFile && <section aria-label="Document preview" className="space-y-2 rounded-md border border-primary-500/30 bg-primary-500/5 p-3">
            <h3 className="text-sm font-semibold text-surface-100">Review before upload</h3>
            <p className="break-words text-xs text-surface-200">{preview.prepared.format} · {preview.prepared.version}</p>
            <p className="text-xs text-surface-200">{preview.prepared.components} recorded {preview.prepared.format === 'SPDX' ? (preview.prepared.components === 1 ? 'package' : 'packages') : `${preview.prepared.components === 1 ? 'component' : 'components'}, including nested assemblies`}</p>
            <p className="break-words text-xs text-surface-300">Destination: {selectedAsset ? `${selectedAsset.name} (#${selectedAsset.id})` : 'Choose an asset above'}</p>
            <p className="text-xs text-surface-400">Document preview only, not full schema validation or a vulnerability scan. Import can still reject malformed evidence.</p>
          </section>}
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
              disabled={uploading || readingFile || !preview.prepared || !selectedAsset || optionsLoading || !!optionsError}
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

function ComponentEvidenceDialog({ component, sbom, assetName, onClose }: { component: SbomComponent; sbom: Sbom; assetName?: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  const fields = [
    ['Component', component.name], ['Version', component.version], ['Supplier', component.supplier],
    ['License', component.license], ['Recorded SHA-256', component.hash_sha256], ['Package URL (PURL)', component.purl], ['CPE', component.cpe],
    ['Recorded vulnerability references', String(component.has_known_vulnerability)],
    ['Component record ID', String(component.id)], ['SBOM record ID', String(sbom.id)],
    ['Asset', `${assetName ? `${assetName} · ` : ''}#${sbom.asset_id}`],
    ['Document format', `${sbom.format}${sbom.version ? ` ${sbom.version}` : ''}`],
    ['Source', sbom.source], ['Uploaded', new Date(sbom.created_at).toLocaleString()],
  ];
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={onClose} />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sbom-component-evidence-title" className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 shadow-[var(--oa-shadow-float)]">
      <div className="flex items-start justify-between gap-4"><h2 id="sbom-component-evidence-title" className="text-lg font-semibold text-surface-50">Recorded component evidence</h2><button type="button" onClick={onClose} className="rounded border border-surface-600 px-3 py-1.5 text-xs text-surface-200">Close</button></div>
      <p className="my-3 text-xs text-surface-400">Values recorded in the uploaded SBOM, not a live package or vulnerability scan. Hashes are supplied by the document and have not been verified against package bytes. Missing identifiers and vulnerability details cannot be reconstructed here.</p>
      <dl className="divide-y divide-surface-700">{fields.map(([label, value]) => <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"><dt className="text-xs text-surface-400">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-surface-100 [overflow-wrap:anywhere]">{value?.trim() ? value : 'Not recorded'}</dd></div>)}</dl>
    </div>
  </div>;
}
