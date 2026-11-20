import { useState } from 'react';

interface ApprovalAction {
  action_type: string;
  target: string;
  reason: string;
  policy_check?: { approved?: boolean };
}
export function ResponseApprovalReview({ planId, caseId, actions, busy, onApprove, onCancel }: {
  planId: number; caseId: number; actions: ApprovalAction[]; busy: boolean;
  onApprove: () => void; onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return <section aria-label={`Approval review for plan ${planId}`} className="mt-4 space-y-3 rounded border border-warning/40 bg-surface-950 p-4">
    <h3 className="text-sm font-semibold text-surface-100">Review plan #{planId} for investigation #{caseId}</h3>
    <p className="text-xs text-surface-400">Approval authorizes the saved plan, it does not execute it. Execution is a separate action. Review all targets and reasons; a saved policy result is not a fresh safety check.</p>
    {actions.length ? <ol aria-label="Actions awaiting approval" tabIndex={0} className="max-h-80 space-y-3 overflow-y-auto">{actions.map((action, index) => <li key={index} className="space-y-2 rounded border border-surface-700 p-3 text-xs">
      <p className="break-words font-semibold text-surface-200">{index + 1}. {action.action_type || 'Action type not recorded'}</p>
      <p className="break-all text-surface-300">Target: {action.target || 'Target not recorded'}</p>
      <p className="whitespace-pre-wrap break-words text-surface-400">{action.reason || 'Reason not recorded'}</p>
      <p className="text-warning">Recorded policy check: {action.policy_check?.approved === true ? 'approved' : action.policy_check?.approved === false ? 'not approved' : 'not recorded'}</p>
    </li>)}</ol> : <p role="alert" className="text-sm text-warning">No saved actions were returned. Approval is unavailable until action evidence is present.</p>}
    <label className="flex items-start gap-2 text-xs text-surface-300"><input type="checkbox" disabled={busy || !actions.length} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the saved actions and targets for plan #{planId}.</label>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={onCancel} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Cancel approval review</button><button type="button" disabled={busy || !actions.length || !acknowledged} onClick={onApprove} className="rounded bg-success px-3 py-2 text-xs font-semibold text-surface-950 disabled:opacity-40">Approve reviewed plan #{planId}</button></div>
  </section>;
}
