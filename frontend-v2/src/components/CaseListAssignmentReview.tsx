import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { checkedTaskAccount } from '../utils/taskSnapshotReview';
import { useDialogFocus } from './ui/useDialogFocus';
interface Person { id: number; email: string; full_name: string | null; role: string; org_id: number | null; is_active: boolean }
interface Preview { case_id: number; owner_id: number; title: string; summary: string | null; status: string; severity: string; due_date: string | null; current_assignee_id: number | null; current_assignee: Person | null; target_id: number | null; target: Person | null; owner: Person; reviewed_fingerprint: string }
function checkedPerson(value: Person | null, id: number | null, active = false) {
  return id === null ? value === null : !!value && value.id === id && typeof value.email === 'string' && !!value.email && (value.full_name === null || typeof value.full_name === 'string') && typeof value.role === 'string' && typeof value.is_active === 'boolean' && (!active || value.is_active) && (value.org_id === null || Number.isSafeInteger(value.org_id) && value.org_id > 0);
}
function checkedPreview(value: Preview, id: number, target: number | null, account: ReturnType<typeof checkedTaskAccount>) {
  if (!value || value.case_id !== id || value.owner_id !== account.id || value.target_id !== target || value.current_assignee_id === target || typeof value.title !== 'string' || typeof value.status !== 'string' || !value.status || typeof value.severity !== 'string' || value.summary !== null && typeof value.summary !== 'string' || value.due_date !== null && typeof value.due_date !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewed_fingerprint) || !checkedPerson(value.owner, account.id, true) || value.owner.email !== account.email || value.owner.org_id !== account.org_id || !checkedPerson(value.current_assignee, value.current_assignee_id) || !checkedPerson(value.target, target, true) || target !== null && (account.org_id === null ? target !== account.id : value.target?.org_id !== account.org_id)) throw Error('Incomplete assignment review.');
  return value;
}
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm disabled:opacity-40';
export function CaseListAssignmentReview({ caseIds, targetId, onClose, onChanged }: { caseIds: number[]; targetId: number | null; onClose: () => void; onChanged: (ids: number[]) => void }) {
  const [rows, setRows] = useState<Preview[] | null>(null), [account, setAccount] = useState<ReturnType<typeof checkedTaskAccount> | null>(null), [ack, setAck] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [outcomes, setOutcomes] = useState<Record<number, string>>({});
  const dialog = useRef<HTMLDivElement>(null), saving = useRef(false), version = useRef(0);
  useDialogFocus(dialog, () => { if (!busy) onClose(); });
  const invalidate = useCallback(() => { version.current++; }, []);
  const caseIdsKey = JSON.stringify(caseIds);
  useEffect(() => { const caseIds: number[] = JSON.parse(caseIdsKey); let active = true; const id = ++version.current;
    if (targetId !== null && (!Number.isSafeInteger(targetId) || targetId < 1) || !caseIds.length || caseIds.length > 100 || new Set(caseIds).size !== caseIds.length || caseIds.some(value => !Number.isSafeInteger(value) || value < 1)) { setError('Choose between 1 and 100 distinct investigations for a complete assignment review. No assignment change was sent.'); setBusy(false); return; }
    Promise.all([apiClient.get('/auth/me'), ...caseIds.map(caseId => apiClient.get(`/cases/${caseId}/assignment-review`, { params: targetId === null ? {} : { target_id: targetId } }))]).then(([who, ...responses]) => { if (!active || id !== version.current) return; const account = checkedTaskAccount(who.data); const previews = responses.map((response, index) => checkedPreview(response.data, caseIds[index], targetId, account)); setAccount(account); setRows(previews); }).catch(() => { if (active) setError('A complete exact assignment review or current account could not be verified. No assignment change was sent. Close and load a fresh review.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; invalidate(); };
  }, [caseIdsKey, targetId, invalidate]);
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
        const response = await apiClient.post(`/cases/${row.case_id}/assign-reviewed`, { user_id: targetId, reviewed_fingerprint: row.reviewed_fingerprint });
        if (id !== version.current) return;
        const value = response.data;
        if (response.status !== 200 || value?.success !== true || value.case_id !== row.case_id || value.assigned_to_id !== targetId || value.reviewed_fingerprint !== row.reviewed_fingerprint || value.assigned_to_email !== (row.target?.email ?? null)) throw Error('Exact assignment change not confirmed.');
        completed.push(row.case_id); states[row.case_id] = `Confirmed ${targetId === null ? 'Unassigned' : row.target?.email}`; inFlight = null; setOutcomes({ ...states });
      }
    } catch {
      if (id === version.current) { if (inFlight !== null) states[inFlight] = 'Unconfirmed, may already have applied. Check fresh case evidence'; setError(inFlight === null ? 'Current account could not be reverified. No assignment change was sent.' : 'Stopped after an unconfirmed assignment change. No automatic retry was sent and later investigations were not changed by this review. Confirmed earlier changes are not rolled back.'); }
    } finally {
      if (id === version.current) { setOutcomes({ ...states }); saving.current = false; setBusy(false); if (completed.length) onChanged(completed); }
    }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review selected investigation assignment" className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h2 className="text-lg font-semibold">Review {caseIds.length} investigation assignment{caseIds.length === 1 ? '' : 's'}</h2>
    <p className="text-sm">Changes who is assigned to these investigations. The assignee can read the investigation and update its status and checklist. This does not transfer ownership, reassign individual checklist tasks, resolve alerts or run response actions.</p>
    <p className="text-sm text-warning">Each assignment is a separate transaction, in the order shown. This is not all-or-nothing. An unconfirmed result stops later writes without retry or rollback. Assigning another person creates an in-app notification and may notify them through their configured channels. Unassigning sends no new assignment notification and does not remove access gained from other roles, watches or task assignments.</p>
    {busy && <p role="status" className="text-sm">Checking exact recipients or applying assignments one at a time...</p>}{error && <p role="alert" className="text-sm text-warning">{error}</p>}
    {account && <p className="text-xs">Account #{account.id} · {account.email} · {account.role} · Organization {account.org_id ?? 'None'}</p>}
    {rows && <><ol aria-label="Exact investigations and recipients" className="space-y-3">{rows.map(row => <li key={row.case_id} className="space-y-2 rounded border border-surface-700 p-3 text-sm"><h3 className="font-semibold">Investigation #{row.case_id}: {row.title}</h3><p>Saved status {row.status} · {row.severity} · Due {row.due_date ?? 'not set'}</p><p>Saved summary: {row.summary ?? 'Not recorded'}</p><p>Current assignee: {row.current_assignee ? `${row.current_assignee.email} (#${row.current_assignee.id})` : 'Unassigned'}</p><p className="font-semibold">New assignee: {row.target ? `${row.target.email} (#${row.target.id})` : 'Unassigned'}</p>{row.target && <p>{row.target.full_name ?? 'Name not recorded'} · {row.target.role} · Active member of organization {row.target.org_id ?? 'None'}</p>}</li>)}</ol>
      <p className="text-xs text-surface-400">The server checks ownership, current case details and assignment, and exact recipient identity, active state and organization before writing. Changed evidence requires a fresh review.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} />I reviewed every investigation, exact recipient and access/notification effects. Apply only these assignments.</label><button type="button" className={control} disabled={busy || !ack} onClick={() => void save()}>Apply reviewed assignments</button></>}
    {!!Object.keys(outcomes).length && <ol aria-label="Assignment outcomes" className="space-y-2 text-sm">{caseIds.map(caseId => <li key={caseId}>Investigation #{caseId}: {outcomes[caseId]}</li>)}</ol>}
    <button type="button" className={control} disabled={busy} onClick={onClose}>Close assignment review</button>
  </div></div>;
}
