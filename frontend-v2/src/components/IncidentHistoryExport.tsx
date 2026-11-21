import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getDownloadErrorMessage } from '../api/errors';

export function IncidentHistoryExport({ assetId, search, kind, disabled }: { assetId: number; search: string; kind: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [prepared, setPrepared] = useState(false);
  const inFlight = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const download = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(''); setPrepared(false);
    let url: string | undefined;
    try {
      const response = await apiClient.get(`/incidents/${assetId}/timeline/export`, {
        params: { ...(search ? { search } : {}), ...(kind ? { kind } : {}) }, responseType: 'blob',
      });
      if (!active.current) return;
      if (!(response.data instanceof Blob) || !response.data.type.startsWith('text/csv')) throw new Error('The server did not return incident history CSV. No download was prepared.');
      url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `asset-${assetId}-incident-history.csv`;
      try { document.body.appendChild(anchor); anchor.click(); } finally { anchor.remove(); }
      setPrepared(true);
    } catch (err) {
      if (!active.current) return;
      const message = await getDownloadErrorMessage(err, 'Incident history export failed. No download was prepared.');
      if (active.current) setError(message);
    } finally {
      if (url) URL.revokeObjectURL(url);
      inFlight.current = false; if (active.current) setBusy(false);
    }
  };
  return <section aria-label="Incident history evidence export" className="space-y-2 rounded border border-surface-700 p-3">
    <button type="button" disabled={disabled || busy} onClick={() => void download()} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">{busy ? 'Preparing incident history CSV...' : 'Export all matching incident history'}</button>
    <p className="text-xs text-surface-400">Downloads all current matching alert-history records for asset #{assetId}, including resolved alerts, not only this page. Uses applied search and event kind, not an unapplied search draft. Limit 10,000 records; larger exports are refused without a partial file. Creation titles and severity use current alert values; change details are saved audit text. Not a frozen snapshot or raw payload. Keep the CSV private; downloaded files have no application access controls. Nothing is sent to another person.</p>
    {prepared && <p role="status" className="text-xs text-primary-300">Incident history download prepared. This does not confirm where your browser saved it.</p>}
    {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
  </section>;
}
