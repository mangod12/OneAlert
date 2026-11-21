import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';

interface Lead {
  control_record_id: number; control_id: string; framework: string; framework_version: string;
  title: string; status: 'partial' | 'not_assessed'; evidence: string; preserve_manual_review: boolean;
}
interface Preview { observed_at: string; measurement_mode: string; limitations: string[]; assessments: Lead[]; total: number }
function valid(value: unknown): value is Preview {
  if (!value || typeof value !== 'object') return false;
  const p = value as Preview;
  return p.measurement_mode === 'metadata_review_leads' && typeof p.observed_at === 'string' && Number.isFinite(Date.parse(p.observed_at))
    && Array.isArray(p.limitations) && p.limitations.length > 0 && p.limitations.every(x => typeof x === 'string')
    && Array.isArray(p.assessments) && p.total === p.assessments.length && p.total <= 100
    && new Set(p.assessments.map(x => x?.control_record_id)).size === p.total
    && p.assessments.every(x => x && Number.isSafeInteger(x.control_record_id) && x.control_record_id > 0
      && ['control_id', 'framework', 'framework_version', 'title', 'evidence'].every(k => typeof x[k as keyof Lead] === 'string')
      && ['partial', 'not_assessed'].includes(x.status) && typeof x.preserve_manual_review === 'boolean');
}

export function ComplianceEvidencePreview({ onClose, onSave, saving }: { onClose: () => void; onSave: () => Promise<void>; saving: boolean }) {
  const dialog = useRef<HTMLDivElement | null>(null), busy = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0), [confirmed, setConfirmed] = useState(false);
  useDialogFocus(dialog, () => { if (!saving && !busy.current) onClose(); });
  useEffect(() => {
    let current = true;
    apiClient.get<unknown>('/compliance/assess/preview').then(res => {
      if (!current) return;
      if (!valid(res.data)) throw new Error('The preview could not be verified. No assessment was saved.');
      setPreview(res.data);
    }).catch(err => { if (current) setError(getApiErrorMessage(err, 'Evidence preview could not be loaded.')); });
    return () => { current = false; };
  }, [attempt]);
  const save = async () => {
    if (!confirmed || !preview?.total || busy.current || saving) return;
    busy.current = true;
    try { await onSave(); } finally { busy.current = false; }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Review automated evidence" className="max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-50">Review automated evidence</h2>
        <button type="button" disabled={saving} onClick={onClose} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Close preview</button></div>
      <p className="text-sm text-surface-300">No assessment has been saved by this preview. These metadata checks cannot mark a control compliant or non-compliant.</p>
      {error ? <div role="alert" className="space-y-2 text-sm text-warning"><p>{error}</p><button type="button" onClick={() => { setError(''); setPreview(null); setConfirmed(false); setAttempt(x => x + 1); }} className="rounded border px-3 py-2">Retry evidence preview</button></div> : !preview ? <p role="status" className="text-sm text-surface-400">Collecting review leads...</p> : <>
        <p className="text-xs text-surface-400">Observed {new Date(preview.observed_at).toLocaleString()} · {preview.total} mapped catalog records. All frameworks, regardless of page filters.</p>
        <ul className="list-disc space-y-2 pl-5 text-xs text-surface-400">{preview.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <ul className="space-y-3">{preview.assessments.map(lead => <li key={lead.control_record_id} className="space-y-2 rounded border border-surface-700 p-3 text-sm text-surface-300">
          <p className="break-words font-medium text-surface-100">{lead.framework} {lead.framework_version} · {lead.control_id}</p><p>{lead.title}</p>
          <p className="text-xs text-surface-400">{lead.preserve_manual_review ? 'Keep latest manual review. No automated record will replace it.' : `Suggested review status: ${lead.status === 'partial' ? 'Partial evidence' : 'Not assessed'}`}</p>
          <p className="break-words text-xs">{lead.evidence}</p>
        </li>)}</ul>
        {preview.total === 0 ? <p className="text-sm text-surface-400">No supported catalog records are available. Nothing to save.</p> : <>
          <label className="flex items-start gap-2 text-sm text-surface-300"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />I understand these are review leads, not compliance verdicts. Save fresh evidence across the mapped catalogs, preserving latest manual reviews.</label>
          <button type="button" disabled={!confirmed || saving} onClick={() => void save()} className="min-h-10 rounded bg-primary-500 px-4 text-sm font-semibold text-surface-950 disabled:opacity-40">{saving ? 'Saving review leads...' : 'Save fresh review leads'}</button>
        </>}
      </>}
    </div>
  </div>;
}
