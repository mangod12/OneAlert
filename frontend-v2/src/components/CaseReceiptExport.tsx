import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
export function CaseReceiptExport({ caseId, category, search, from, through }: { caseId: number; category: string; search: string; from: string; through: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef(true), running = useRef(false);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  const download = async () => {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    try {
      const response = await apiClient.get(`/cases/${caseId}/change-receipts/export`, { responseType: 'blob', params: { category, ...(search ? { search } : {}), ...(from ? { from_date: from } : {}), ...(through ? { through_date: through } : {}) } });
      if (!current.current) return;
      if (response.status !== 200 || !(response.data instanceof Blob) || !response.data.type.startsWith('text/csv')) throw Error('Invalid export');
      const url = URL.createObjectURL(response.data), link = document.createElement('a'), revoke = URL.revokeObjectURL;
      try { link.href = url; link.download = `investigation-${caseId}-saved-receipts.csv`; document.body.append(link); link.click(); } finally { link.remove(); setTimeout(() => revoke(url), 1000); }
    } catch { if (current.current) setError('Saved receipts could not be exported. No file was downloaded. Refresh the receipts, narrow the applied filters if needed, then retry.'); }
    finally { if (current.current) { running.current = false; setBusy(false); } }
  };
  return <section aria-label="Export saved investigation receipts" className="space-y-2 rounded border border-surface-700 p-3 text-xs"><p>CSV includes all matching saved receipts across pages, up to 5,000 entries, using the applied category, text and UTC dates above. Larger exports are refused without a partial file. Draft inputs are not applied. Export is a new current read, not a frozen copy of this page. Changing the applied scope or leaving this view cancels a pending download.</p><p>Contains saved receipt detail and actor account IDs. Keep the file private unless you intend to share it. These records are not complete history, proof of delivery or proof of remediation.</p><button type="button" disabled={busy} onClick={() => void download()} className="max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 disabled:opacity-40">{busy ? 'Exporting saved receipts...' : 'Export matching saved receipts CSV'}</button>{error && <p role="alert" className="text-warning">{error}</p>}</section>;
}
