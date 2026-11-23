import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { checkedTaskAccount } from '../utils/taskSnapshotReview';
import { useDialogFocus } from './ui/useDialogFocus';
interface DeletionEvidence { plan: { id: number; case_id: number; status: string; autonomy_level: string; actions: unknown[] }; approval_count: number; approval_status_counts: Record<string, number>; deletion_fingerprint: string }
function checkedEvidence(value: DeletionEvidence, planId: number) {
  const plan = value?.plan, counts = value?.approval_status_counts;
  if (!plan || plan.id !== planId || !Number.isSafeInteger(plan.case_id) || plan.case_id < 1 || !['draft', 'rejected'].includes(plan.status) || !['L0', 'L1', 'L2', 'L3', 'L4'].includes(plan.autonomy_level) || !Array.isArray(plan.actions) || !/^[a-f0-9]{64}$/.test(value.deletion_fingerprint) || !Number.isSafeInteger(value.approval_count) || value.approval_count < 0 || !counts || typeof counts !== 'object' || Array.isArray(counts) || Object.entries(counts).some(([state, count]) => !state || !Number.isSafeInteger(count) || count < 0) || Object.values(counts).reduce((sum, count) => sum + count, 0) !== value.approval_count) throw Error('Deletion evidence did not match this plan.');
  return value;
}
export function ResponsePlanRemovalReview({ planId, onCancel, onDeleted }: { planId: number; onCancel: () => void; onDeleted: () => void }) {
  const [evidence, setEvidence] = useState<DeletionEvidence | null>(null), [account, setAccount] = useState<ReturnType<typeof checkedTaskAccount> | null>(null), [typed, setTyped] = useState(''), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDivElement>(null), saving = useRef(false), reads = useRef(0);
  useDialogFocus(dialog, () => { if (!busy) onCancel(); });
  useEffect(() => { let active = true; const id = ++reads.current;
    Promise.all([apiClient.get(`/response-plans/${planId}/deletion-review`), apiClient.get('/auth/me')]).then(([source, who]) => { if (!active || id !== reads.current) return; setEvidence(checkedEvidence(source.data, planId)); setAccount(checkedTaskAccount(who.data)); }).catch(() => { if (active) setError('Exact saved plan, approval history or current account could not be verified. No deletion was sent. Close and load a fresh review.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; reads.current += 1; };
  }, [planId]);
  const remove = async () => {
    if (saving.current || busy || !evidence || !account || !acknowledged || typed !== `DELETE ${planId}`) return;
    saving.current = true; setBusy(true); setError(''); const id = ++reads.current, frozen = evidence; setEvidence(null); let sent = false;
    try {
      const who = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (id !== reads.current) return;
      if (JSON.stringify(who) !== JSON.stringify(account)) throw Error('Current account changed.');
      sent = true; const response = await apiClient.post(`/response-plans/${planId}/delete-reviewed`, { reviewed_fingerprint: frozen.deletion_fingerprint });
      if (id !== reads.current) return;
      const result = response.data;
      if (response.status !== 200 || result?.success !== true || result.deleted !== true || result.plan_id !== planId || result.case_id !== frozen.plan.case_id || result.approvals_deleted !== frozen.approval_count) throw Error('Deletion not verified.');
      setNotice(`Deletion confirmed for plan #${planId} on investigation #${frozen.plan.case_id}. ${result.approvals_deleted} approval records were removed. The investigation and external systems were not changed. A general removal audit entry remains, not a recoverable copy.`); onDeleted();
    } catch { if (id === reads.current) setError(sent ? 'Deletion could not be confirmed and may already have applied. No automatic retry was sent. Close and load fresh evidence before any further action.' : 'The current account could not be reverified. No deletion mutation was sent. Close and load a fresh review.'); }
    finally { if (id === reads.current) { saving.current = false; setBusy(false); } }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label={`Review permanent removal of plan ${planId}`} className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h2 className="text-lg font-semibold">Review permanent removal of plan #{planId}</h2>{busy && <p role="status" className="text-sm">Checking exact deletion evidence...</p>}{error && <p role="alert" className="text-sm text-warning">{error}</p>}{notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {evidence && account && <><p className="text-xs">Account #{account.id} · {account.email} · {account.role} · Organization {account.org_id ?? 'None'}</p><p className="text-sm">Investigation #{evidence.plan.case_id} · Plan #{planId} · {evidence.plan.status} → permanently deleted · {evidence.plan.autonomy_level}</p>
      <ol aria-label="Saved actions to be removed" className="space-y-2">{evidence.plan.actions.map((action, index) => <li key={index} className="rounded border border-surface-700 p-3 text-xs"><p>Saved action {index + 1}</p><pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(action, null, 2)}</pre></li>)}</ol>{!evidence.plan.actions.length && <p className="text-sm">No saved actions were returned.</p>}
      <section aria-label="Approval history to be removed" className="space-y-2 rounded border border-danger/40 p-3 text-sm"><h3 className="font-semibold">{evidence.approval_count} approval records will be permanently removed</h3>{Object.entries(evidence.approval_status_counts).map(([state, count]) => <p key={state}>{state}: {count}</p>)}<p>Includes recorded request reasons, reviewers and decision timestamps for these rows. Counts include all approval history, not only the current queue page.</p></section>
      <p className="text-sm text-warning">This cannot be undone here. The plan, all its saved actions/results and all its approval records are removed. The investigation, alerts, checklist tasks and external systems are not deleted or changed; no action is executed. Existing general audit entries remain, but are not a recoverable copy of the removed evidence.</p>
      <p className="text-xs text-surface-400">The server rechecks ownership and binds removal to this plan and every approval row fingerprint under row locks. Changed plan or approval history requires a fresh review. This review is not an export or backup.</p>
      <label className="block text-sm">Type DELETE {planId} to confirm this exact plan<input aria-label={`Type DELETE ${planId}`} disabled={busy} value={typed} onChange={event => setTyped(event.target.value)} className="mt-2 w-full rounded border border-surface-600 bg-surface-950 p-3 text-sm" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this plan and the approval history that will be permanently removed.</label><button type="button" disabled={busy || !acknowledged || typed !== `DELETE ${planId}`} onClick={() => void remove()} className="rounded bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Permanently remove reviewed plan</button>
    </>}
    <button type="button" disabled={busy} onClick={onCancel} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Close plan removal review</button>
  </div></div>;
}
