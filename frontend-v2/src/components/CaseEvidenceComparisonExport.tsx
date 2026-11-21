import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { caseComparisonPackage } from '../utils/caseComparisonPackage';
export function CaseEvidenceComparisonExport({ caseId, otherId, kind }: { caseId: number; otherId: number; kind: 'alert' | 'event' }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const revision = useRef(0), inFlight = useRef(false);
  useEffect(() => { const invalidate = () => { revision.current++; }; return invalidate; }, []);
  const download = async () => {
    if (inFlight.current) return;
    const request = ++revision.current; inFlight.current = true; setBusy(true); setError(''); setDone(false);
    try {
      const { data } = await apiClient.get(`/cases/${caseId}/evidence-overlap/export`, { params: { other_case_id: otherId, kind } });
      if (request !== revision.current) return;
      const content = caseComparisonPackage(data, caseId, otherId, kind);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      try {
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = `case-${caseId}-vs-${otherId}-${kind}-evidence-comparison.json`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove(); setDone(true);
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (err) { if (request === revision.current) setError(getApiErrorMessage(err, 'The complete comparison could not be exported. No file was saved.')); }
    finally { if (request === revision.current) { inFlight.current = false; setBusy(false); } }
  };
  return <section aria-label="Export complete evidence comparison" className="space-y-2 rounded border border-surface-700 p-3">
    <button type="button" disabled={busy} onClick={() => void download()} className="max-w-full rounded border border-surface-600 px-3 py-2 text-left text-xs text-surface-200 disabled:opacity-40">{busy ? 'Preparing complete comparison...' : 'Download all comparison sets JSON'}</button>
    <p className="text-xs text-surface-400">Exports shared IDs and both unique sets for these investigations and this evidence kind, across all pages. Fresh export-time read, not a copy of the displayed page. Includes record labels, severity and times, not raw payloads. Limited to 10,000 distinct retrievable records; larger comparisons fail without a partial file. Review sensitive metadata before sharing. Downloading sends nothing to anyone.</p>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {done && <p role="status" className="text-xs text-primary-300">Complete comparison download prepared. Displayed evidence is unchanged.</p>}
  </section>;
}
