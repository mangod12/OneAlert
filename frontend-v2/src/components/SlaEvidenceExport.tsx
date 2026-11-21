import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
function validDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
interface Props { kind: 'alerts' | 'cases'; days: number; outcome: string; query: string; }
export function SlaEvidenceExport({ kind, days, outcome, query }: Props) {
  const active = useRef(true), lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const download = async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await apiClient.get('/reports/sla/records/export', { params: { kind, days, outcome, query } });
      if (!active.current) return;
      if (!data || data.format !== 'onealert-sla-evidence-v1' || data.complete !== true || data.kind !== kind || data.days !== days || data.outcome !== outcome || data.query !== query || data.offset !== 0
        || typeof data.scope !== 'string' || !data.scope.trim() || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 1000 || !Array.isArray(data.records) || data.records.length !== data.total
        || ![data.window_start, data.window_end].every(validDate) || Date.parse(data.window_end) - Date.parse(data.window_start) !== (days - 1) * 86400000 || typeof data.generated_at !== 'string' || !Number.isFinite(Date.parse(data.generated_at))
        || new Set(data.records.map((r: {id?: number}) => r?.id)).size !== data.records.length
        || data.records.some((r: {id:number;title:string;status:string;severity:string;due_date:string;completed_on:string|null;outcome:string;reason:string}) => !r || !Number.isSafeInteger(r.id) || r.id < 1 || typeof r.title !== 'string' || typeof r.status !== 'string' || typeof r.severity !== 'string' || typeof r.reason !== 'string' || !validDate(r.due_date) || r.due_date < data.window_start || r.due_date > data.window_end || (r.completed_on !== null && !validDate(r.completed_on)) || !['met', 'breached', 'unknown'].includes(r.outcome) || (outcome !== 'all' && r.outcome !== outcome))) throw new Error('The SLA export did not match the complete requested scope. No file was downloaded.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      try { const a = document.createElement('a'); a.href = url; a.download = `onealert-${kind}-sla-evidence-${days}d.json`; document.body.appendChild(a); try { a.click(); } finally { a.remove(); } } finally { URL.revokeObjectURL(url); }
      setNotice(`Downloaded ${data.total} matching SLA records. This file contains a new current read, not the earlier report snapshot.`);
    } catch (err) { if (active.current) setError(getApiErrorMessage(err, 'SLA evidence export unavailable. No file was downloaded.')); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  return <section aria-label="Complete SLA evidence export" className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-400"><button type="button" disabled={busy} onClick={() => void download()} className="rounded border border-surface-600 px-3 py-2 text-primary-300 disabled:opacity-40">{busy ? 'Preparing SLA evidence...' : 'Download all matching SLA evidence JSON'}</button><p>Exports every matching record across pages, using the selected search, outcome and report day window. Up to 1,000 records; larger requests are refused without a partial file. This is a new current read, not the displayed summary snapshot or an audit history. Includes saved record titles, identifiers and completion evidence. Keep the file within an appropriate audience. Changing filters cancels a pending download.</p>{error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status" className="text-surface-300">{notice}</p>}</section>;
}
