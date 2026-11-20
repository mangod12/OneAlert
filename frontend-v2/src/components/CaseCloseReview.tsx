import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
interface Preview { case_id: number; title: string; status: string; target_status: string; resolution: string | null; can_edit_resolution: boolean; task_total: number; alert_total: number; unavailable_alert_links: number; reviewed_fingerprint: string; open_tasks: { id: number; title: string; done: boolean; due_date: string | null; assignee_id: number | null }[]; remaining_alerts: { id: number; title: string; status: string; severity: string }[] }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 disabled:opacity-40';
export function CaseCloseReview({ caseId, targetStatus, label, onClose, onSaved }: { caseId: number; targetStatus: string; label: string; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDivElement>(null), pending = useRef(false), mounted = useRef(true);
  const [preview, setPreview] = useState<Preview | null>(null), [resolution, setResolution] = useState(''), [ack, setAck] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [writeError, setWriteError] = useState(''), [retry, setRetry] = useState(0);
  useDialogFocus(dialog, () => { if (!pending.current) onClose(); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setPreview(null); setResolution(''); setAck(false); setLoading(true); setError(''); setWriteError('');
    void apiClient.get(`/cases/${caseId}/closeout-review`, { params: { target_status: targetStatus } }).then(response => {
      if (!active) return;
      const value: Preview = response.data;
      if (!value || value.case_id !== caseId || value.target_status !== targetStatus || value.status === targetStatus || typeof value.title !== 'string' || typeof value.status !== 'string' || (value.resolution !== null && typeof value.resolution !== 'string') || typeof value.can_edit_resolution !== 'boolean' || typeof value.reviewed_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewed_fingerprint) || [value.task_total, value.alert_total, value.unavailable_alert_links].some(count => !Number.isSafeInteger(count) || count < 0) || !Array.isArray(value.open_tasks) || !Array.isArray(value.remaining_alerts) || value.open_tasks.length > value.task_total || value.remaining_alerts.length > value.alert_total || new Set(value.open_tasks.map(row => row?.id)).size !== value.open_tasks.length || new Set(value.remaining_alerts.map(row => row?.id)).size !== value.remaining_alerts.length || value.open_tasks.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1 || row.done !== false || typeof row.title !== 'string' || (row.due_date !== null && typeof row.due_date !== 'string')) || value.remaining_alerts.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.title !== 'string' || typeof row.status !== 'string' || typeof row.severity !== 'string' || ['resolved', 'false_positive'].includes(row.status))) throw new Error('The close-out review did not match this investigation and remaining work. Refresh before changing status.');
      setPreview(value); setResolution(value.resolution ?? '');
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Close-out review unavailable. No status change was sent.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, targetStatus, retry]);
  const remaining = !!preview && (preview.open_tasks.length > 0 || preview.remaining_alerts.length > 0 || preview.unavailable_alert_links > 0);
  const save = async () => {
    if (pending.current || loading || !preview || error || writeError || (remaining && !ack)) return;
    pending.current = true; setBusy(true);
    const params = { status_update: targetStatus, reviewed_fingerprint: preview.reviewed_fingerprint, ...(preview.can_edit_resolution ? { resolution: resolution.trim() } : {}) };
    try {
      const response = await apiClient.patch(`/cases/${caseId}`, null, { params });
      if (!mounted.current) return;
      const value = response.data;
      if (value?.success !== true || value.data?.case_id !== caseId || value.data?.status !== targetStatus || value.data?.reviewed_fingerprint !== preview.reviewed_fingerprint || value.data?.resolution !== (preview.can_edit_resolution ? resolution.trim() || null : preview.resolution)) throw new Error('The reply did not confirm this exact reviewed status and resolution.');
      onSaved();
    } catch (err) { if (mounted.current) setWriteError(getApiErrorMessage(err, 'The status change could not be confirmed.')); }
    finally { if (mounted.current) { pending.current = false; setBusy(false); } }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label={`${label} this case?`} className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5">
    <h2 className="text-lg font-semibold text-surface-100">{label} this case?</h2><p className="text-xs text-surface-400">A case status is a workflow state, not proof of remediation. This does not complete tasks, resolve linked alerts, execute response plans or change external systems.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading current close-out review...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {preview && !error && <><p className="break-words text-sm text-surface-100">Investigation #{preview.case_id}: {preview.title}</p><p className="text-sm text-warning">Status change: {preview.status.replaceAll('_', ' ')} to {targetStatus.replaceAll('_', ' ')}. You can reopen the case later, but that is another recorded status change.</p>
      <p className="text-sm text-surface-300">{preview.open_tasks.length} open of {preview.task_total} checklist tasks · {preview.remaining_alerts.length} linked {preview.remaining_alerts.length === 1 ? 'alert' : 'alerts'} not recorded as resolved or false positive, of {preview.alert_total} available linked alerts.</p>
      {!!preview.unavailable_alert_links && <p className="text-sm text-warning">{preview.unavailable_alert_links} alert {preview.unavailable_alert_links === 1 ? 'link' : 'links'} could not be included as owner-scoped alert evidence. Their disposition is unknown.</p>}
      {!!preview.open_tasks.length && <details className="text-xs text-surface-300"><summary>Review {preview.open_tasks.length} remaining checklist {preview.open_tasks.length === 1 ? 'task' : 'tasks'}</summary><ul aria-label="Remaining close-out tasks" tabIndex={0} className="mt-2 max-h-44 space-y-2 overflow-y-auto">{preview.open_tasks.map(row => <li key={row.id} className="break-words rounded border border-surface-700 p-2">Task #{row.id}: {row.title} · Due {row.due_date ?? 'not set'}</li>)}</ul></details>}
      {!!preview.remaining_alerts.length && <details className="text-xs text-surface-300"><summary>Review {preview.remaining_alerts.length} remaining linked {preview.remaining_alerts.length === 1 ? 'alert' : 'alerts'}</summary><ul aria-label="Remaining close-out alerts" tabIndex={0} className="mt-2 max-h-44 space-y-2 overflow-y-auto">{preview.remaining_alerts.map(row => <li key={row.id} className="break-words rounded border border-surface-700 p-2">Alert #{row.id}: {row.title} · {row.severity} · {row.status.replaceAll('_', ' ')}</li>)}</ul></details>}
      {preview.can_edit_resolution ? <label className="block space-y-2 text-sm text-surface-200">Resolution summary (optional)<textarea aria-label="Resolution summary (optional)" value={resolution} disabled={busy || !!writeError} onChange={event => setResolution(event.target.value)} rows={3} className={`${control} block w-full`} /><span className="block text-xs text-surface-400">Blank clears the saved resolution. Describe the outcome and any remaining follow-up.</span></label> : <p className="break-words text-xs text-surface-400">Only the owner can edit the resolution. Saved resolution: {preview.resolution || 'Not recorded'}.</p>}
      {remaining && <label className="flex items-start gap-2 text-sm text-warning"><input type="checkbox" className="mt-1 shrink-0" checked={ack} disabled={busy || !!writeError} onChange={event => setAck(event.target.checked)} /><span>I reviewed the remaining or unknown work and want to change only this investigation's status.</span></label>}
    </>}
    {writeError && <p role="alert" className="text-sm text-danger">{writeError} Do not blindly retry. Refresh this review or close it to reload the case and check whether the change already happened.</p>}
    <p className="text-xs text-surface-400">Changed case details, checklist state or linked-alert evidence invalidate this review. Refresh replaces the review, resolution draft and acknowledgement.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={control} disabled={busy || loading} onClick={() => setRetry(value => value + 1)}>Refresh close-out review</button><button type="button" className={control} disabled={busy || loading || !preview || !!error || !!writeError || (remaining && !ack)} onClick={() => void save()}>{busy ? 'Saving reviewed close-out...' : label}</button></div>
  </div></div>;
}
