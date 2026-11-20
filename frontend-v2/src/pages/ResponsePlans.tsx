import { ResponseDecisionEvidence } from '../components/ResponseDecisionEvidence';
import { useCallback, useState, useEffect, useRef } from 'react';
import apiClient from '../api/client';
import { CheckCircle, XCircle, Play, Clock, Download, Shield, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { responseActionCsv } from '../utils/responseActionCsv';
import { toast } from '../components/Toast';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton, DegradedBanner } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { ResponseApprovalReview } from '../components/ResponseApprovalReview';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

interface ResponseAction {
  priority?: number;
  action_type: string;
  target: string;
  reason: string;
  policy_check?: { approved?: boolean };
  execution_result?: { status?: string; detail?: string; executed_at?: string };
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

interface ExecutionOutcome {
  plan_id: number;
  status: string;
  total_actions: number;
  succeeded: number;
  failed: number;
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
  const requestId = useRef(0);
  const approving = useRef(false);
  const [reviewApprovalId, setReviewApprovalId] = useState<number | null>(null);
  const [approvalError, setApprovalError] = useState('');
  const [plans, setPlans] = useState<ResponsePlan[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [executionNotice, setExecutionNotice] = useState<{ text: string; success: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const res = await apiClient.get('/response-plans/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'response-plans.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The export could not be downloaded.'), 'error');
    } finally {
      setExporting(false);
    }
  };
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const selectedPlan = plans.find(plan => plan.id === selectedPlanId) ?? null;
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [workingPlan, setWorkingPlan] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'reject' | 'execute' | 'delete'; planId: number } | null>(null);

  const fetchPlans = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    const [planResult, approvalResult] = await Promise.allSettled([
      apiClient.get('/response-plans/', { params: { page, size: 20, ...(statusFilter ? { status: statusFilter } : {}) } }),
      apiClient.get('/response-plans/pending-approvals'),
    ]);
    if (request !== requestId.current) return;
    const nextErrors: string[] = [];
    if (planResult.status === 'fulfilled') {
      const data = planResult.value.data;
      const count = typeof data.total === 'number' ? data.total : (data.data || []).length;
      const lastPage = Math.max(1, Math.ceil(count / 20));
      if (page > lastPage) { setPage(lastPage); return; }
      setPlans(data.data || []);
      setTotal(count);
    }
    else { setPlans([]); setTotal(0); setSelectedPlanId(null); nextErrors.push(getApiErrorMessage(planResult.reason, 'Response plans could not be loaded.')); }
    if (approvalResult.status === 'fulfilled') setPending(approvalResult.value.data.data || []);
    else { setPending([]); nextErrors.push(getApiErrorMessage(approvalResult.reason, 'Pending approvals could not be loaded.')); }
    setErrors(nextErrors);
    setLoading(false);
  }, [statusFilter, page]);

  const approvePlan = async (planId: number) => {
    if (approving.current || workingPlan !== null || loading || errors.length || !pending.some(item => item.plan_id === planId && item.id === reviewApprovalId)) return;
    approving.current = true;
    setApprovalError('');
    setWorkingPlan(planId);
    try {
      const response = await apiClient.post(`/response-plans/${planId}/approve`);
      if (response.data?.success !== true || response.data?.plan_status !== 'approved') {
        setApprovalError('Approval returned without a confirmed approved state. Refresh and review the current plan before trying again.');
        setReviewApprovalId(null);
        await fetchPlans();
        return;
      }
      setReviewApprovalId(null);
      toast('Plan approved', 'success');
      await fetchPlans();
    } catch (err) { setApprovalError(getApiErrorMessage(err, 'Approval could not be confirmed. Review the current plan before retrying.')); }
    finally { approving.current = false; setWorkingPlan(null); }
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
    setExecutionNotice(null);
    try {
      const response = await apiClient.post<{ data?: ExecutionOutcome }>(`/response-plans/${planId}/execute`);
      const outcome = response.data.data;
      const verified = outcome?.plan_id === planId && Number.isInteger(outcome.total_actions)
        && Number.isInteger(outcome.succeeded) && Number.isInteger(outcome.failed)
        && outcome.total_actions > 0 && outcome.succeeded >= 0 && outcome.failed >= 0
        && outcome.succeeded + outcome.failed === outcome.total_actions;
      const allSucceeded = verified && outcome.status === 'completed' && outcome.failed === 0;
      const text = verified
        ? `Plan #${planId} reported ${outcome.succeeded} of ${outcome.total_actions} actions succeeded; ${outcome.failed} failed or skipped. Recorded status: ${outcome.status}.`
        : `Execution request for plan #${planId} returned without a verifiable outcome. Review the refreshed plan before trying any action again.`;
      setExecutionNotice({ text, success: !!allSucceeded });
      toast(allSucceeded ? `Plan #${planId}: all actions succeeded.` : `Plan #${planId}: review execution outcome.`, allSucceeded ? 'success' : 'warning');
      setConfirmAction(null);
      await fetchPlans();
    } catch (err) { toast(getApiErrorMessage(err, 'Execution failed.'), 'error'); }
    finally { setWorkingPlan(null); }
  };

  const deletePlan = async (planId: number) => {
    if (workingPlan !== null) return;
    setWorkingPlan(planId);
    try {
      await apiClient.delete(`/response-plans/${planId}`);
      toast('Plan deleted', 'success');
      setConfirmAction(null);
      if (selectedPlanId === planId) setSelectedPlanId(null);
      await fetchPlans();
    } catch (err) { toast(getApiErrorMessage(err, 'Failed to delete plan.'), 'error'); }
    finally { setWorkingPlan(null); }
  };

  useEffect(() => {
    void fetchPlans();
    return () => { requestId.current += 1; };
  }, [fetchPlans]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Act" title="Response Plans" description="Review, approve, and execute guarded response actions with a durable human decision trail." />

      {approvalError && <p role="alert" className="rounded border border-warning/40 p-3 text-sm text-warning">{approvalError}</p>}
      {executionNotice && <p role={executionNotice.success ? 'status' : 'alert'} className={`rounded-md border p-4 text-sm ${executionNotice.success ? 'border-success/30 text-success' : 'border-warning/30 text-warning'}`}>{executionNotice.text}</p>}
      {errors.length > 0 && (plans.length > 0 || pending.length > 0)
        ? <DegradedBanner messages={errors} onRetry={() => void fetchPlans()} />
        : errors.length > 0 && <ErrorState title="Response plans unavailable" description={errors.join(' · ')} action={<RetryButton onClick={() => void fetchPlans()} />} />}
      {loading && <LoadingSurface label="Loading response plans" />}

      <ResponseDecisionEvidence />

      {/* Pending Approvals */}
      {pending.length > 0 && (
        <div className="bg-warning/5 border border-warning/30 rounded-md p-6">
          <h2 className="text-lg font-semibold text-warning mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Pending Approvals ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map(a => (
              <div key={a.id} className="min-w-0 rounded-lg bg-surface-900/50 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-surface-50 font-medium">Plan #{a.plan_id} — Case #{a.case_id}</p>
                  <p className="text-xs text-surface-400 mt-1">{a.reason}</p>
                  <p className="text-xs text-surface-500 mt-1">
                    {a.actions?.length || 0} actions · Level {a.autonomy_level}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={workingPlan !== null || loading || errors.length > 0} onClick={() => { setReviewApprovalId(a.id); setApprovalError(''); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-success hover:bg-success/80 text-surface-950 rounded text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                    <CheckCircle className="w-3.5 h-3.5" /> Review approval
                  </button>
                  <button disabled={workingPlan !== null || loading || errors.length > 0} onClick={() => setConfirmAction({ type: 'reject', planId: a.plan_id })}
                    className="flex items-center gap-1 px-3 py-1.5 bg-danger hover:bg-danger/80 text-surface-950 rounded text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
                {!loading && !errors.length && reviewApprovalId === a.id && <ResponseApprovalReview key={JSON.stringify(a)} planId={a.plan_id} caseId={a.case_id} actions={a.actions || []} busy={workingPlan !== null} onApprove={() => void approvePlan(a.plan_id)} onCancel={() => { if (workingPlan === null) setReviewApprovalId(null); }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plans Table */}
      <div className="oa-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-surface-50">All Response Plans</h2>
          <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { void exportCsv(); }}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-md border border-surface-600 px-2.5 py-1.5 text-xs text-surface-200 hover:border-primary-500 hover:text-primary-300 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
          <label className="flex items-center gap-2 text-xs text-surface-400">
            Status
            <select
              aria-label="Filter plans by status"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); setSelectedPlanId(null); }}
              className="rounded-md border border-surface-600 bg-surface-950 px-2 py-1.5 text-sm text-surface-100"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending approval</option>
              <option value="approved">Approved</option>
              <option value="executing">Executing</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
              <option value="partial">Partial</option>
            </select>
          </label>
          </div>
        </div>
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
                      {(p.status === 'draft' || p.status === 'rejected') && (
                        <button aria-label={`Delete plan ${p.id}`} disabled={workingPlan !== null || loading || errors.length > 0} onClick={e => { e.stopPropagation(); setConfirmAction({ type: 'delete', planId: p.id }); }}
                          className="flex items-center gap-1 px-2 py-1 bg-danger/10 hover:bg-danger/20 text-danger rounded text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                          <Trash2 className="w-3 h-3" /> Delete
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

      {!loading && errors.length === 0 && total > 0 && <nav aria-label="Response plan pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p role="status" className="text-surface-400">Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total} matching plans · Page {page} of {Math.ceil(total / 20)}</p>
        <div className="flex gap-2">
          <button type="button" disabled={page === 1 || workingPlan !== null} onClick={() => { setSelectedPlanId(null); setPage(value => value - 1); }} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Previous plans</button>
          <button type="button" disabled={page * 20 >= total || workingPlan !== null} onClick={() => { setSelectedPlanId(null); setPage(value => value + 1); }} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Next plans</button>
        </div>
      </nav>}

      {/* Plan Detail */}
      {selectedPlan && (
        <div className="oa-panel p-6">
          <h2 className="text-lg font-semibold text-surface-50 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary-400" />
            Plan #{selectedPlan.id} Actions
          </h2>
          <button type="button" disabled={!selectedPlan.actions?.length || loading || errors.length > 0} onClick={() => {
            const url = URL.createObjectURL(new Blob([responseActionCsv(selectedPlan)], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url; link.download = `response-plan-${selectedPlan.id}-action-evidence.csv`; link.click(); URL.revokeObjectURL(url);
          }} className="mb-3 flex items-center gap-2 rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40"><Download className="h-4 w-4" aria-hidden="true" />Export recorded action evidence</button>
          <p className="mb-4 text-sm text-surface-400">Saved action results from this plan. Missing results do not establish whether an action ran. Review recorded details before deciding on any follow-up.</p>
          <div className="space-y-2">
            {selectedPlan.actions?.map((action, i) => (
              <div key={i} className="min-w-0 space-y-3 rounded-lg border border-surface-700 bg-surface-900/50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-mono text-surface-500">#{action.priority || i + 1}</span>
                  <span className={clsx('break-all text-xs px-2 py-0.5 rounded font-medium',
                    action.policy_check?.approved ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                    {action.action_type}
                  </span>
                  <span className="min-w-0 break-all text-sm text-surface-300">{action.target}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-xs text-surface-400">{action.reason || 'No action reason recorded.'}</p>
                <dl className="space-y-2 border-t border-surface-700 pt-3 text-sm">
                  <div><dt className="text-xs text-surface-400">Recorded execution status</dt><dd className={action.execution_result?.status === 'completed' ? 'text-success' : 'text-surface-200'}>{action.execution_result?.status || 'No execution result recorded'}</dd></div>
                  {action.execution_result && <>
                    <div><dt className="text-xs text-surface-400">Recorded execution detail</dt><dd className="whitespace-pre-wrap break-words text-surface-300">{action.execution_result.detail || 'No execution detail recorded.'}</dd></div>
                    <div><dt className="text-xs text-surface-400">Recorded execution time</dt><dd className="break-words text-surface-300">{action.execution_result.executed_at ? (Number.isNaN(Date.parse(action.execution_result.executed_at)) ? action.execution_result.executed_at : new Date(action.execution_result.executed_at).toLocaleString()) : 'Not recorded'}</dd></div>
                  </>}
                </dl>
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
      {confirmAction?.type === 'delete' && (
        <ConfirmDialog
          title={`Delete plan #${confirmAction.planId}?`}
          description="This permanently removes the draft or rejected plan and its approval history. This cannot be undone."
          confirmLabel="Delete plan"
          tone="danger"
          busy={workingPlan !== null}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void deletePlan(confirmAction.planId)}
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
