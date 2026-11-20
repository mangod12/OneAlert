import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';

interface Assessment {
  id: number; control_id: number; status: string; evidence_type: string | null;
  evidence_detail: string | null; assessed_at: string; assessed_by: string;
}
interface Review { assessment: Assessment; reviewed_fingerprint: string }
const statuses = ['compliant', 'partial', 'non_compliant', 'not_applicable', 'not_assessed'];
export function ComplianceAssessmentReview({ id, control, initialStatus, onClose, onSaved }: {
  id: number; control: { id: number; control_id: string; title: string }; initialStatus?: string;
  onClose: () => void; onSaved: (assessment: Assessment) => void;
}) {
  const ref = useRef<HTMLDivElement>(null), pending = useRef(false), mounted = useRef(true), request = useRef(0);
  const [review, setReview] = useState<Review | null>(null), [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(''), [type, setType] = useState(''), [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState('');
  const close = () => { if (!pending.current) onClose(); };
  useDialogFocus(ref, close);
  const load = async (first = false) => {
    if (pending.current) return;
    const sequence = ++request.current;
    setLoading(true); setError(''); setReview(null); setBlocked(false);
    try {
      const { data } = await apiClient.get<Review>(`/compliance/assessments/${id}/review`);
      if (!mounted.current || sequence !== request.current) return;
      if (data.assessment.id !== id || data.assessment.control_id !== control.id || !/^[a-f0-9]{64}$/.test(data.reviewed_fingerprint)) throw new Error('The server did not confirm this exact assessment.');
      setReview(data); setStatus(first && initialStatus ? initialStatus : data.assessment.status);
      setType(data.assessment.evidence_type ?? ''); setDetail(data.assessment.evidence_detail ?? '');
    } catch (err) { if (mounted.current && sequence === request.current) setError(getApiErrorMessage(err, 'Assessment review could not be loaded.')); }
    finally { if (mounted.current && sequence === request.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; void load(true); return () => { mounted.current = false; request.current += 1; }; }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (pending.current || blocked || loading || !review) return;
    pending.current = true; setBusy(true); setError('');
    const payload = { status, evidence_type: type || null, evidence_detail: detail.trim() || null };
    try {
      const { data } = await apiClient.patch<Assessment>(`/compliance/assessments/${id}`, payload, { params: { reviewed_fingerprint: review.reviewed_fingerprint } });
      if (data.id !== id || data.control_id !== control.id || data.status !== payload.status || data.evidence_type !== payload.evidence_type || data.evidence_detail !== payload.evidence_detail) throw new Error('The server did not confirm the exact change. Reload the review to verify before trying again.');
      if (mounted.current) onSaved(data);
    } catch (err) { if (mounted.current) { setBlocked(true); setError(getApiErrorMessage(err, 'Save was not confirmed. Reload the review to verify current evidence before trying again.')); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div aria-hidden="true" className="absolute inset-0 bg-surface-950/70" onClick={close} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`Review assessment for ${control.control_id}`} className="relative max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 text-surface-200 shadow-xl">
      <h2 className="text-base font-semibold">Review assessment for {control.control_id}</h2>
      <p className="break-words text-sm">{control.title}</p>
      <p className="text-xs text-surface-400">This edits saved record #{id}, not a new review or an automated check. Its original assessment time stays unchanged. Newer records may determine current posture.</p>
      {loading && <p role="status">Loading current saved evidence...</p>}
      {error && <p role="alert" className="break-words text-sm text-danger">{error} {blocked && 'Saving is paused until you reload the review.'}</p>}
      {review && <>
        <section aria-label="Current saved assessment" className="space-y-1 rounded border border-surface-700 p-3 text-xs">
          <p>Saved status: {review.assessment.status}</p><p>Evidence type: {review.assessment.evidence_type || 'None'}</p>
          <p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words">{review.assessment.evidence_detail || 'No evidence detail recorded.'}</p>
          <p className="break-words">Recorded: {review.assessment.assessed_at} · Last editor: {review.assessment.assessed_by}</p>
        </section>
        <label className="block text-sm">Review status<select aria-label="Review status" disabled={busy || blocked} value={status} onChange={e => setStatus(e.target.value)} className="mt-1 w-full rounded border border-surface-600 bg-surface-950 p-2">{statuses.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
        <label className="block text-sm">Evidence type<select aria-label="Evidence type" disabled={busy || blocked} value={type} onChange={e => setType(e.target.value)} className="mt-1 w-full rounded border border-surface-600 bg-surface-950 p-2"><option value="">None</option>{['manual', 'automated', 'document'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="block text-sm">Details<textarea aria-label="Details" disabled={busy || blocked} rows={4} value={detail} onChange={e => setDetail(e.target.value)} className="mt-1 w-full rounded border border-surface-600 bg-surface-950 p-2" /></label>
        {(!type || !detail.trim()) && <p className="text-xs text-warning">Empty fields will clear the corresponding saved evidence.</p>}
      </>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || blocked || loading || !review} onClick={() => void save()} className="rounded bg-primary-500 px-3 py-2 text-sm font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Saving...' : 'Save reviewed assessment'}</button>
        <button type="button" disabled={busy || loading} onClick={() => void load()} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Reload review and discard draft</button>
        <button type="button" disabled={busy} onClick={close} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Cancel</button>
      </div>
    </div>
  </div>;
}
