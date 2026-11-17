import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { CheckCircle, XCircle, Play, Clock, Shield } from 'lucide-react';
import clsx from 'clsx';
import { toast } from '../components/Toast';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton, DegradedBanner } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

interface ResponseAction {
  priority?: number;
  action_type: string;
  target: string;
  reason: string;
  policy_check?: { approved?: boolean };
  execution_result?: { status?: string };
}

interface ResponsePlan {
  id: number;
  case_id: number;
  actions: ResponseAction[];
  status: string;
  autonomy_level: string;
  created_by: string;
  approved_by: number | null;
  approved_at: string | null;
  created_at: string;
}

interface PendingApproval {
  id: number;
  plan_id: number;
  case_id: number;
  status: string;
  reason: string;
  actions: ResponseAction[];
  autonomy_level: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-surface-600/20 text-surface-400',
  pending_approval: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  executing: 'bg-info/10 text-info',
  completed: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
  partial: 'bg-warning/10 text-warning',
};

export function ResponsePlans() {
  const [plans, setPlans] = useState<ResponsePlan[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const selectedPlan = plans.find(plan => plan.id === selectedPlanId) ?? null;
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [workingPlan, setWorkingPlan] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'reject' | 'execute'; planId: number } | null>(null);

  const fetchPlans = async () => {
    setLoading(true);
    const [planResult, approvalResult] = await Promise.allSettled([
      apiClient.get('/response-plans/'),
      apiClient.get('/response-plans/pending-approvals'),
    ]);
    const nextErrors: string[] = [];
    if (planResult.status === 'fulfilled') setPlans(planResult.value.data.data || []);
    else nextErrors.push(getApiErrorMessage(planResult.reason, 'Response plans could not be loaded.'));
    if (approvalResult.status === 'fulfilled') setPending(approvalResult.value.data.data || []);
    else nextErrors.push(getApiErrorMessage(approvalResult.reason, 'Pending approvals could not be loaded.'));
    setErrors(nextErrors);
    setLoading(false);
  };

  const approvePlan = async (planId: number) => {
    if (workingPlan !== null) return;
    setWorkingPlan(planId);
    try {
      await apiClient.post(`/response-plans/${planId}/approve`);
      toast('Plan approved', 'success');
      await fetchPlans();
    } catch (err) { toast(getApiErrorMessage(err, 'Failed to approve plan.'), 'error'); }
    finally { setWorkingPlan(null); }
  };

  const rejectPlan = async (planId: number, reason: string) => {
    if (workingPlan !== null) return;
    setWorkingPlan(planId);
    try {
      await apiClient.post(`/response-plans/${planId}/reject`, { reason: reason || 'Manual rejection' });
      toast('Plan rejected', 'warning');
      setConfirmAction(null);
      await fetchPlans();
    } catch (err) { toast(getApiErrorMessage(err, 'Failed to reject plan.'), 'error'); }
    finally { setWorkingPlan(null); }
  };

  const executePlan = async (planId: number) => {
    if (workingPlan !== null) return;
    setWorkingPlan(planId);
    try {
      await apiClient.post(`/response-plans/${planId}/execute`);
      toast('Plan executed successfully', 'success');
      setConfirmAction(null);
      await fetchPlans();
    } catch (err) { toast(getApiErrorMessage(err, 'Execution failed.'), 'error'); }
    finally { setWorkingPlan(null); }
  };

  useEffect(() => { void fetchPlans(); }, []);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Act" title="Response Plans" description="Review, approve, and execute guarded response actions with a durable human decision trail." />

      {errors.length > 0 && (plans.length > 0 || pending.length > 0)
        ? <DegradedBanner messages={errors} onRetry={() => void fetchPlans()} />
        : errors.length > 0 && <ErrorState title="Response plans unavailable" description={errors.join(' · ')} action={<RetryButton onClick={() => void fetchPlans()} />} />}
      {loading && <LoadingSurface label="Loading response plans" />}

      {/* Pending Approvals */}
      {pending.length > 0 && (
        <div className="bg-warning/5 border border-warning/30 rounded-md p-6">
          <h2 className="text-lg font-semibold text-warning mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Pending Approvals ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map(a => (
              <div key={a.id} className="bg-surface-900/50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm text-surface-50 font-medium">Plan #{a.plan_id} — Case #{a.case_id}</p>
                  <p className="text-xs text-surface-400 mt-1">{a.reason}</p>
                  <p className="text-xs text-surface-500 mt-1">
                    {a.actions?.length || 0} actions · Level {a.autonomy_level}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button disabled={workingPlan !== null || loading || errors.length > 0} onClick={() => approvePlan(a.plan_id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-success hover:bg-success/80 text-surface-950 rounded text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                    <CheckCircle className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button disabled={workingPlan !== null || loading || errors.length > 0} onClick={() => setConfirmAction({ type: 'reject', planId: a.plan_id })}
                    className="flex items-center gap-1 px-3 py-1.5 bg-danger hover:bg-danger/80 text-surface-950 rounded text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plans Table */}
      <div className="oa-panel p-6">
        <h2 className="text-lg font-semibold text-surface-50 mb-4">All Response Plans</h2>
        {plans.length === 0 ? (
          !loading && errors.length === 0 && <EmptyState title="No response plans" description="Run the agent pipeline to generate a guarded response plan." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-surface-500 text-xs">
                  <th className="text-left p-3">ID</th>
                  <th className="text-left p-3">Case</th>
                  <th className="text-left p-3">Actions</th>
                  <th className="text-left p-3">Level</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Created</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id} tabIndex={0} className="border-b border-surface-800 hover:bg-surface-800/50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPlanId(selectedPlanId === p.id ? null : p.id); } }}
                    onClick={() => setSelectedPlanId(selectedPlanId === p.id ? null : p.id)}>
                    <td className="p-3 text-surface-300">#{p.id}</td>
                    <td className="p-3 text-surface-300">Case #{p.case_id}</td>
                    <td className="p-3 text-surface-300">{p.actions?.length || 0}</td>
                    <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-primary-500/20 text-primary-400">{p.autonomy_level}</span></td>
                    <td className="p-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded', STATUS_STYLES[p.status] || STATUS_STYLES.draft)}>
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 text-surface-500 text-xs">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="p-3">
                      {p.status === 'approved' && (
                        <button disabled={workingPlan !== null || loading || errors.length > 0} onClick={e => { e.stopPropagation(); setConfirmAction({ type: 'execute', planId: p.id }); }}
                          className="flex items-center gap-1 px-2 py-1 bg-primary-500 hover:bg-primary-400 text-surface-950 rounded text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                          <Play className="w-3 h-3" /> Execute
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Plan Detail */}
      {selectedPlan && (
        <div className="oa-panel p-6">
          <h2 className="text-lg font-semibold text-surface-50 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary-400" />
            Plan #{selectedPlan.id} Actions
          </h2>
          <div className="space-y-2">
            {selectedPlan.actions?.map((action, i) => (
              <div key={i} className="flex items-center gap-4 p-3 bg-surface-900/50 rounded-lg">
                <span className="text-xs font-mono text-surface-500 w-6">#{action.priority || i + 1}</span>
                <span className={clsx('text-xs px-2 py-0.5 rounded font-medium',
                  action.policy_check?.approved ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                  {action.action_type}
                </span>
                <span className="text-sm text-surface-300 flex-1">{action.target}</span>
                <span className="text-xs text-surface-500">{action.reason}</span>
                {action.execution_result && (
                  <span className={clsx('text-xs px-2 py-0.5 rounded',
                    action.execution_result.status === 'completed' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
                    {action.execution_result.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmAction?.type === 'execute' && (
        <ConfirmDialog
          title={`Execute plan #${confirmAction.planId}?`}
          description="Execution runs every guarded action in this approved plan immediately. Results are recorded on the plan's decision trail."
          confirmLabel="Execute now"
          busy={workingPlan !== null}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void executePlan(confirmAction.planId)}
        />
      )}
      {confirmAction?.type === 'reject' && (
        <ConfirmDialog
          title={`Reject plan #${confirmAction.planId}?`}
          description="Rejection closes the plan and its pending approval. The reason is recorded on the approval's decision trail."
          confirmLabel="Reject plan"
          tone="danger"
          reasonLabel="Reason for rejection (optional)"
          reasonPlaceholder="e.g. Isolation window overlaps the maintenance freeze"
          busy={workingPlan !== null}
          onCancel={() => setConfirmAction(null)}
          onConfirm={reason => void rejectPlan(confirmAction.planId, reason)}
        />
      )}
    </div>
  );
}
