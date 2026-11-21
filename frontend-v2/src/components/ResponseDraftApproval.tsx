import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { ResponseApprovalReview } from './ResponseApprovalReview';
interface Action { action_type: string; target: string; reason: string; priority?: number; execution_result?: unknown }
interface Review { plan: { id: number; case_id: number; status: string; actions: Action[] }; review_fingerprint: string }
interface Props { planId: number; onApproved: () => void }
export function ResponseDraftApproval(props: Props) { return <DraftApproval key={props.planId} {...props} />; }
function DraftApproval({ planId, onApproved }: Props) {
  const [snapshot, setSnapshot] = useState<Review | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const request = useRef(0), saving = useRef(false);
  useEffect(() => () => { request.current += 1; }, []);
  const read = async () => {
    if (saving.current) return;
    const id = ++request.current; setBusy(true); setSnapshot(null); setError(''); setNotice('');
    try {
      const { data: value } = await apiClient.get<Review>(`/response-plans/${planId}/approval-review`);
      if (id !== request.current) return;
      const p = value?.plan, text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
      if (!p || p.id !== planId || !Number.isSafeInteger(p.case_id) || p.case_id < 1 || !/^[a-f0-9]{64}$/.test(value.review_fingerprint) || typeof p.status !== 'string') throw new Error('The approval review did not match this saved plan. Load a fresh review.');
      if (p.status !== 'draft') { setNotice(`Current saved plan state is ${p.status}, not draft. No draft approval is available from this read.`); return; }
      if (!Array.isArray(p.actions) || p.actions.length < 1 || p.actions.length > 100 || p.actions.some(a => !a || typeof a !== 'object' || Array.isArray(a) || !text(a.action_type) || !text(a.target) || !text(a.reason) || 'execution_result' in a || a.priority !== undefined && (!Number.isSafeInteger(a.priority) || a.priority < 0))) throw new Error('This draft has incomplete or unsupported action evidence. No approval can be submitted from this review.');
      setSnapshot(value);
    } catch (err) { if (id === request.current) setError(getApiErrorMessage(err, 'Draft approval review could not be loaded.')); }
    finally { if (id === request.current) setBusy(false); }
  };
  const approve = async () => {
    if (saving.current || busy || !snapshot) return;
    saving.current = true; const id = ++request.current, fingerprint = snapshot.review_fingerprint; setBusy(true); setSnapshot(null); setError(''); setNotice('');
    try {
      const { data: result } = await apiClient.post(`/response-plans/${planId}/approve`, { reviewed_fingerprint: fingerprint });
      if (id !== request.current) return;
      if (result?.success !== true || result.plan_status !== 'approved') throw new Error('Approval did not return a confirmed approved state. Load a fresh review before any further action.');
      setNotice(`Approval recorded for plan #${planId}. No execution was requested. Reloaded evidence may differ from the earlier read.`); onApproved();
    } catch (err) { if (id === request.current) setError(`${getApiErrorMessage(err, 'Approval could not be confirmed.')} Load a fresh review before retrying; no execution was requested.`); }
    finally { if (id === request.current) { saving.current = false; setBusy(false); } }
  };
  return <section aria-label={`Draft approval for plan ${planId}`} className="oa-panel space-y-3 p-4 sm:p-6"><h2 className="text-sm font-semibold text-surface-100">Review saved draft #{planId} for approval</h2><p className="text-xs text-surface-400">Separate from the read-only evidence above. Load a fresh exact-plan review, inspect every proposed action and target, then explicitly acknowledge it. Approval does not run any action. Existing queue filters do not limit the plan being approved.</p><button type="button" disabled={busy} onClick={() => void read()} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">{busy ? 'Working on draft review...' : 'Load fresh draft approval review'}</button>{error && <p role="alert" className="text-xs text-danger">{error}</p>}{notice && <p role="status" className="text-xs text-surface-300">{notice}</p>}{snapshot && <ResponseApprovalReview key={snapshot.review_fingerprint} planId={planId} caseId={snapshot.plan.case_id} actions={snapshot.plan.actions} reviewFingerprint={snapshot.review_fingerprint} busy={busy} onApprove={() => void approve()} onCancel={() => setSnapshot(null)} />}</section>;
}
