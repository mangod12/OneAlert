import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import type { ComponentScope } from './ComponentAssetImpact';
interface ExportRecord { component: { id: number; sbom_id: number; version: string | null; has_known_vulnerability: number }; sbom_id: number; asset_id: number }
interface ExportSnapshot extends ComponentScope { schema: string; complete: boolean; scoped_asset_id: number | null; total: number; document_count: number; asset_count: number; retrieved_at: string; limitations: string[]; records: ExportRecord[] }
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
export function ComponentEvidenceExport({ scope, assetId }: { scope: ComponentScope; assetId?: number }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const active = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { active.current += 1; }, []);
  const download = async () => {
    if (inFlight.current) return;
    inFlight.current = true; const id = ++active.current; setBusy(true); setError(''); setStatus('');
    try {
      const { data } = await apiClient.get<ExportSnapshot>('/sbom/component-search/export', { params: { ...scope, ...(assetId === undefined ? {} : { asset_id: assetId }) } });
      if (id !== active.current) return;
      if (data.schema !== 'onealert.recorded-component-evidence.v1' || data.complete !== true || data.search !== scope.search || data.version !== scope.version || data.vulnerable_only !== scope.vulnerable_only || data.scoped_asset_id !== (assetId ?? null) || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 5000 || !Array.isArray(data.records) || data.records.length !== data.total || new Set(data.records.map(row => row.component?.id)).size !== data.total || data.records.some(row => !positive(row.asset_id) || !positive(row.sbom_id) || !positive(row.component?.id) || row.component.sbom_id !== row.sbom_id || (assetId !== undefined && row.asset_id !== assetId) || (!!scope.version && row.component.version !== scope.version) || (scope.vulnerable_only && !(row.component.has_known_vulnerability > 0))) || new Set(data.records.map(row => row.sbom_id)).size !== data.document_count || new Set(data.records.map(row => row.asset_id)).size !== data.asset_count || typeof data.retrieved_at !== 'string' || !Number.isFinite(Date.parse(data.retrieved_at)) || !Array.isArray(data.limitations) || !data.limitations.length || data.limitations.some(note => typeof note !== 'string')) throw new Error('Export did not match the complete applied component scope. No file was downloaded.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'onealert-recorded-component-evidence.json'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); }
      finally { URL.revokeObjectURL(url); }
      setStatus(`Downloaded ${data.total} matching saved component rows with document provenance. This file is a new current read, not a live installation inventory.`);
    } catch (err) { if (id === active.current) setError(getApiErrorMessage(err, 'The complete component evidence could not be downloaded.')); }
    finally { if (id === active.current) { inFlight.current = false; setBusy(false); } }
  };
  return <section aria-label="Complete component evidence export" className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-400"><button type="button" disabled={busy} onClick={() => void download()} className="rounded border border-surface-600 px-3 py-2 text-primary-300 disabled:opacity-40">{busy ? 'Preparing complete component evidence...' : 'Download all matching component evidence JSON'}</button><p>Exports matching saved component rows across all result pages, not grouped totals or draft edits. Applied version, vulnerability and exact asset filters are retained. Up to 5,000 rows, with no partial download if the limit is exceeded. Includes identifiers, document provenance and recorded fields. Keep this evidence file within an appropriate audience.</p>{error && <p role="alert" className="text-danger">{error}</p>}{status && <p role="status" className="text-surface-300">{status}</p>}</section>;
}
