import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { checkedTaskAccount } from '../utils/taskSnapshotReview';
import { useDialogFocus } from './ui/useDialogFocus';
interface Preview { case_id: number; title: string; status: string; target_status: string; resolution: string | null; can_edit_resolution: boolean; task_total: number; alert_total: number; unavailable_alert_links: number; reviewed_fingerprint: string; open_tasks: { id: number; title: string; done: boolean; due_date: string | null }[]; remaining_alerts: { id: number; title: string; status: string; severity: string }[] }
function checkedPreview(value: Preview, id: number, target: string) {
  if (!value || value.case_id !== id || value.target_status !== target || value.status === target || typeof value.title !== 'string' || typeof value.status !== 'string' || !value.status || value.resolution !== null && typeof value.resolution !== 'string' || typeof value.can_edit_resolution !== 'boolean' || !/^[a-f0-9]{64}$/.test(value.reviewed_fingerprint) || [value.task_total, value.alert_total, value.unavailable_alert_links].some(count => !Number.isSafeInteger(count) || count < 0) || !Array.isArray(value.open_tasks) || !Array.isArray(value.remaining_alerts) || value.open_tasks.length > value.task_total || value.remaining_alerts.length > value.alert_total || new Set(value.open_tasks.map(row => row?.id)).size !== value.open_tasks.length || new Set(value.remaining_alerts.map(row => row?.id)).size !== value.remaining_alerts.length || value.open_tasks.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1 || row.done !== false || typeof row.title !== 'string' || row.due_date !== null && typeof row.due_date !== 'string') || value.remaining_alerts.some(row => !row || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.title !== 'string' || typeof row.status !== 'string' || typeof row.severity !== 'string' || ['resolved', 'false_positive'].includes(row.status))) throw Error('Incomplete close-out review.');
  return value;
}
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm disabled:opacity-40';
export function CaseListCloseReview({ caseIds, targetStatus, onClose, onChanged }: { caseIds: number[]; targetStatus: string; onClose: () => void; onChanged: (ids: number[]) => void }) {
  const [rows, setRows] = useState<Preview[] | null>(null), [account, setAccount] = useState<ReturnType<typeof checkedTaskAccount> | null>(null), [ack, setAck] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [outcomes, setOutcomes] = useState<Record<number, string>>({});
  const dialog = useRef<HTMLDivElement>(null), saving = useRef(false), version = useRef(0);
  useDialogFocus(dialog, () => { if (!busy) onClose(); });
  const invalidate = useCallback(() => { version.current++; }, []);
  const caseIdsKey = JSON.stringify(caseIds);
  useEffect(() => { const caseIds: number[] = JSON.parse(caseIdsKey); let active = true; const id = ++version.current;
    if (!['resolved', 'closed', 'false_positive'].includes(targetStatus) || !caseIds.length || caseIds.length > 100 || new Set(caseIds).size !== caseIds.length || caseIds.some(value => !Number.isSafeInteger(value) || value < 1)) { setError('Choose between 1 and 100 distinct investigations for a complete close-out review. No status change was sent.'); setBusy(false); return; }
    Promise.all([apiClient.get('/auth/me'), ...caseIds.map(caseId => apiClient.get(`/cases/${caseId}/closeout-review`, { params: { target_status: targetStatus } }))]).then(([who, ...responses]) => { if (!active || id !== version.current) return; const previews = responses.map((response, index) => checkedPreview(response.data, caseIds[index], targetStatus)); setAccount(checkedTaskAccount(who.data)); setRows(previews); }).catch(() => { if (active) setError('A complete exact close-out review or current account could not be verified. No status change was sent. Close and load a fresh review.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; invalidate(); };
  }, [caseIdsKey, targetStatus, invalidate]);
  const save = async () => {
    if (saving.current || busy || !rows || !account || !ack || error || Object.keys(outcomes).length) return;
    saving.current = true; setBusy(true); const id = ++version.current, frozen = rows; setRows(null); const completed: number[] = [], states: Record<number, string> = Object.fromEntries(frozen.map(row => [row.case_id, 'Not sent'])); let inFlight: number | null = null;
    try {
      const who = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (id !== version.current) return;
      if (JSON.stringify(who) !== JSON.stringify(account)) throw Error('Account changed.');
      for (const row of frozen) {
        if (id !== version.current) return;
        inFlight = row.case_id; states[row.case_id] = 'Awaiting confirmation'; setOutcomes({ ...states });
        const response = await apiClient.patch(`/cases/${row.case_id}`, null, { params: { status_update: targetStatus, reviewed_fingerprint: row.reviewed_fingerprint } });
        if (id !== version.current) return;
        const value = response.data?.data;
        if (response.status !== 200 || response.data?.success !== true || value?.case_id !== row.case_id || value.status !== targetStatus || value.reviewed_fingerprint !== row.reviewed_fingerprint || value.resolution !== row.resolution || typeof value.closed_at !== 'string' || Number.isNaN(Date.parse(value.closed_at))) throw Error('Exact status change not confirmed.');
        completed.push(row.case_id); states[row.case_id] = `Confirmed ${targetStatus}; saved resolution preserved`; inFlight = null; setOutcomes({ ...states });
      }
    } catch {
      if (id === version.current) { if (inFlight !== null) states[inFlight] = 'Unconfirmed, may already have applied. Check fresh case evidence'; setError(inFlight === null ? 'Current account could not be reverified. No status change was sent.' : 'Stopped after an unconfirmed status change. No automatic retry was sent and later investigations were not changed by this review. Confirmed earlier changes are not rolled back.'); }
    } finally {
      if (id === version.current) { setOutcomes({ ...states }); saving.current = false; setBusy(false); if (completed.length) onChanged(completed); }
    }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review selected investigation close-out" className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h2 className="text-lg font-semibold">Review {caseIds.length} investigation close-out{caseIds.length === 1 ? '' : 's'}</h2><p className="text-sm">Target workflow status: {targetStatus}. This is not proof of remediation. It does not complete checklist tasks, resolve linked alerts, execute response plans or change external systems.</p>
    <p className="text-sm text-warning">Each investigation is changed in a separate transaction, in the order shown. This is not all-or-nothing. An unconfirmed result stops later writes without retry or rollback. Saved resolution summaries are preserved exactly. To edit one, use its investigation detail page.</p>
    {busy && <p role="status" className="text-sm">Checking exact review or applying statuses one at a time...</p>}{error && <p role="alert" className="text-sm text-warning">{error}</p>}
    {account && <p className="text-xs">Account #{account.id} · {account.email} · {account.role} · Organization {account.org_id ?? 'None'}</p>}
    {rows && <><ol aria-label="Exact investigations and remaining work" className="space-y-3">{rows.map(row => <li key={row.case_id} className="space-y-2 rounded border border-surface-700 p-3 text-sm"><h3 className="font-semibold">Investigation #{row.case_id}: {row.title}</h3><p>{row.status} → {targetStatus}</p><p>Saved resolution to preserve: {row.resolution === null ? 'Not recorded' : JSON.stringify(row.resolution)}</p><p>{row.open_tasks.length} open of {row.task_total} checklist tasks · {row.remaining_alerts.length} remaining of {row.alert_total} available linked alerts · {row.unavailable_alert_links} unavailable alert links</p>
      {!!row.unavailable_alert_links && <p className="text-warning">Some owner-scoped alert evidence is unavailable. Its disposition is unknown.</p>}
      {!!row.open_tasks.length && <details><summary>Review remaining tasks for #{row.case_id}</summary><ul className="mt-2 space-y-2">{row.open_tasks.map(task => <li key={task.id}>Task #{task.id}: {task.title} · Due {task.due_date ?? 'not set'}</li>)}</ul></details>}
      {!!row.remaining_alerts.length && <details><summary>Review remaining alerts for #{row.case_id}</summary><ul className="mt-2 space-y-2">{row.remaining_alerts.map(alert => <li key={alert.id}>Alert #{alert.id}: {alert.title} · {alert.severity} · {alert.status}</li>)}</ul></details>}
    </li>)}</ol><p className="text-xs text-surface-400">Changed case details, assignment, checklist state or linked-alert evidence invalidate that case's review. Status changes may notify existing followers through their configured channels. No new notification recipients are chosen here.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} />I reviewed every selected investigation and its remaining or unknown work. Change only the listed workflow statuses and preserve each saved resolution.</label><button type="button" className={control} disabled={busy || !ack} onClick={() => void save()}>Apply reviewed close-out statuses</button></>}
    {!!Object.keys(outcomes).length && <ol aria-label="Close-out outcomes" className="space-y-2 text-sm">{caseIds.map(caseId => <li key={caseId}>Investigation #{caseId}: {outcomes[caseId]}</li>)}</ol>}
    <button type="button" className={control} disabled={busy} onClick={onClose}>Close close-out review</button>
  </div></div>;
}
