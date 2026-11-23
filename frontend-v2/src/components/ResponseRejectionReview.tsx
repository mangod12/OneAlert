import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { checkedTaskAccount } from '../utils/taskSnapshotReview';
import { useDialogFocus } from './ui/useDialogFocus';
interface RejectionEvidence { plan: { id: number; case_id: number; status: string; autonomy_level: string; actions: unknown[] }; review_fingerprint: string }
function checkedEvidence(value: RejectionEvidence, planId: number) {
  const plan = value?.plan;
  if (!plan || plan.id !== planId || !Number.isSafeInteger(plan.case_id) || plan.case_id < 1 || !['draft', 'pending_approval'].includes(plan.status) || !['L0', 'L1', 'L2', 'L3', 'L4'].includes(plan.autonomy_level) || !Array.isArray(plan.actions) || !/^[a-f0-9]{64}$/.test(value.review_fingerprint)) throw Error('Exact saved rejection evidence could not be verified.');
  return value;
}
export function ResponseRejectionReview({ planId, onCancel, onRejected }: { planId: number; onCancel: () => void; onRejected: () => void }) {
  const [evidence, setEvidence] = useState<RejectionEvidence | null>(null), [account, setAccount] = useState<ReturnType<typeof checkedTaskAccount> | null>(null), [reason, setReason] = useState(''), [reasonReview, setReasonReview] = useState<string | null>(null), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDivElement>(null), saving = useRef(false), reads = useRef(0);
  useDialogFocus(dialog, () => { if (!busy) onCancel(); });
  useEffect(() => { let active = true; const id = ++reads.current; setBusy(true);
    Promise.all([apiClient.get(`/response-plans/${planId}/approval-review`), apiClient.get('/auth/me')]).then(([source, who]) => { if (!active || id !== reads.current) return; setEvidence(checkedEvidence(source.data, planId)); setAccount(checkedTaskAccount(who.data)); }).catch(() => { if (active) setError('The exact saved plan or current account could not be verified. No rejection was sent. Close and load a fresh review.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; reads.current += 1; };
  }, [planId]);
  const reject = async () => {
    if (saving.current || busy || !evidence || !account || reasonReview === null || !acknowledged) return;
    saving.current = true; setBusy(true); setError(''); const id = ++reads.current, frozen = evidence; setEvidence(null); setReasonReview(null);
    let sent = false;
    try {
      const who = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (id !== reads.current) return;
      if (JSON.stringify(who) !== JSON.stringify(account)) throw Error('Current account changed.');
      sent = true;
      const response = await apiClient.post(`/response-plans/${planId}/reject-reviewed`, { reviewed_fingerprint: frozen.review_fingerprint, reason: reasonReview });
      if (id !== reads.current) return;
      const result = response.data;
      if (response.status !== 200 || result?.success !== true || result.plan_status !== 'rejected' || result.plan_id !== planId || result.case_id !== frozen.plan.case_id || !Number.isSafeInteger(result.approvals_resolved) || result.approvals_resolved < 0) throw Error('Rejection outcome unknown.');
      setNotice(`Rejection recorded for plan #${planId} on investigation #${frozen.plan.case_id}. ${result.approvals_resolved} pending approval requests were rejected. No execution or external action was requested.`); onRejected();
    } catch { if (id === reads.current) setError(sent ? 'Rejection could not be confirmed and may already have applied. No automatic retry was sent. Close and load a fresh saved-plan review before any further decision.' : 'The current account could not be reverified. No rejection mutation was sent. Close and load a fresh review.'); }
    finally { if (id === reads.current) { saving.current = false; setBusy(false); } }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label={`Review rejection of plan ${planId}`} className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h2 className="text-lg font-semibold">Review rejection of plan #{planId}</h2>
    {busy && <p role="status" className="text-sm">Checking exact saved plan...</p>}{error && <p role="alert" className="text-sm text-warning">{error}</p>}{notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {evidence && account && <><p className="text-xs">Account #{account.id} · {account.email} · {account.role} · Organization {account.org_id ?? 'None'}</p><p className="text-sm">Investigation #{evidence.plan.case_id} · Saved plan #{planId} · {evidence.plan.status} → rejected · {evidence.plan.autonomy_level}</p>
      <ol aria-label="Exact saved plan actions for rejection" className="space-y-2">{evidence.plan.actions.map((action, index) => <li key={index} className="rounded border border-surface-700 p-3 text-xs"><p>Saved action {index + 1}</p><pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(action, null, 2)}</pre></li>)}</ol>{!evidence.plan.actions.length && <p className="text-sm text-warning">No saved actions. Rejection can still close this draft or pending plan.</p>}
      <p className="text-sm text-warning">Rejection closes this saved plan and all currently pending approval requests for it. The exact nonempty reason replaces each pending request reason; an empty reason preserves existing request reasons. The decision is audited. This does not execute actions, delete evidence, close the investigation or change external systems. Pending approval membership can change before confirmation; the server uses the current pending set.</p>
      <p className="text-xs text-surface-400">The server binds this decision to the saved plan fingerprint, including its owner, investigation, state, autonomy and all actions. Changed plan evidence is rejected. No execution is requested.</p>
      {reasonReview === null ? <><label className="block text-sm">Reason for rejection (optional)<textarea aria-label="Reason for rejection (optional)" maxLength={2000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 min-h-24 w-full rounded border border-surface-600 bg-surface-950 p-3 text-sm" /></label><p className="text-xs text-surface-400">{reason.length}/2000 characters. Nothing is replaced with a default reason. Spaces and line breaks are kept exactly.</p><button type="button" disabled={busy} onClick={() => { setReasonReview(reason); setAcknowledged(false); }} className="rounded border border-warning/50 px-3 py-2 text-sm text-warning">Review exact rejection reason</button></> : <><h3 className="text-sm font-semibold">Exact reason to record</h3><pre className="whitespace-pre-wrap break-all rounded border border-surface-700 p-3 text-sm">{reasonReview === '' ? '(Empty: preserve existing pending-request reasons)' : JSON.stringify(reasonReview)}</pre><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this plan, its saved actions and the exact reason.</label><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => { setReasonReview(null); setAcknowledged(false); }} className="rounded border border-surface-600 px-3 py-2 text-sm">Edit rejection reason</button><button type="button" disabled={busy || !acknowledged} onClick={() => void reject()} className="rounded bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Confirm reviewed rejection</button></div></>}
    </>}
    <button type="button" disabled={busy} onClick={onCancel} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Close rejection review</button>
  </div></div>;
}
