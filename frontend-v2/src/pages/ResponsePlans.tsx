import { recordedValueText } from '../utils/recordedValueText';
import { ResponseRejectionReview } from '../components/ResponseRejectionReview';
import { ResponseDraftApproval } from '../components/ResponseDraftApproval';
import { useSearchParams } from 'react-router-dom';
import { ResponseDecisionEvidence } from '../components/ResponseDecisionEvidence';
import { isAxiosError } from 'axios';
import { useCallback, useState, useEffect, useRef } from 'react';
import apiClient from '../api/client';
import { ResponsePlanComparison } from '../components/ResponsePlanComparison';
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
  execution_result?: { execution_mode?: string; status?: string; detail?: string; executed_at?: string };
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
  execution_mode?: string;
  plan_id: number;
  status: string;
  total_actions: number;
  succeeded: number;
  failed: number;
}

interface PendingApproval {
  requested_by?: string | null;
  plan_status?: string | null;
  review_fingerprint?: string;
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

export function ResponsePlansRoute() {
  const [params] = useSearchParams();
  const ids = params.getAll('plan');
  return <ResponsePlans linkedPlanId={ids.length > 1 ? 'invalid' : ids[0] ?? null} compareFrom={params.getAll('compare_from').length > 1 ? 'invalid' : params.get('compare_from')} compareTo={params.getAll('compare_to').length > 1 ? 'invalid' : params.get('compare_to')} />;
}

export function ResponsePlans({ linkedPlanId = null, compareFrom = null, compareTo = null }: { linkedPlanId?: string | null; compareFrom?: string | null; compareTo?: string | null }) {
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const requestId = useRef(0);
  const approving = useRef(false);
  const [reviewApprovalId, setReviewApprovalId] = useState<number | null>(null);
  const [approvalError, setApprovalError] = useState('');
  const [plans, setPlans] = useState<ResponsePlan[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [historyDraft, setHistoryDraft] = useState(''), [historyQuery, setHistoryQuery] = useState('');
  const [historyCaseDraft, setHistoryCaseDraft] = useState(''), [historyCase, setHistoryCase] = useState('');
  const [historyLevel, setHistoryLevel] = useState(''), [historySort, setHistorySort] = useState('newest');
  const invalidHistoryCase = historyCaseDraft.trim() !== '' && (!/^[1-9][0-9]*$/.test(historyCaseDraft.trim()) || !Number.isSafeInteger(Number(historyCaseDraft.trim())));
  const [executionNotice, setExecutionNotice] = useState<{ text: string; success: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportBusy = useRef(false), exportReads = useRef(0);
  const [exportError, setExportError] = useState('');
  useEffect(() => { exportReads.current += 1; exportBusy.current = false; setExporting(false); setExportError(''); return () => { exportReads.current += 1; }; }, [statusFilter, historyQuery, historyCase, historyLevel, historySort]);
  const exportCsv = async () => {
    if (exportBusy.current) return;
    exportBusy.current = true; const request = ++exportReads.current;
    setExporting(true); setExportError('');
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (historyQuery) params.query = historyQuery;
      if (historyCase) params.case_id = historyCase;
      if (historyLevel) params.autonomy_level = historyLevel;
      if (historySort !== 'newest') params.sort = historySort;
      const res = await apiClient.get('/response-plans/export', { params, responseType: 'blob' });
      if (request !== exportReads.current) return;
      if (!(res.data instanceof Blob) || !res.data.type.startsWith('text/csv')) throw new Error('The server did not return response plan CSV. No file was downloaded.');
      const url = URL.createObjectURL(res.data);
      try { const link = document.createElement('a'); link.href = url; link.download = 'response-plans.csv'; link.click(); }
      finally { URL.revokeObjectURL(url); }
    } catch (err: unknown) {
      if (request !== exportReads.current) return;
      const response = (err as { response?: { data?: unknown } })?.response;
      if (response?.data instanceof Blob) { try { response.data = JSON.parse(await response.data.text()); } catch { /* Standard fallback. */ } }
      if (request === exportReads.current) setExportError(getApiErrorMessage(err, 'Response plan export unavailable. No file was downloaded.'));
    } finally {
      if (request === exportReads.current) { exportBusy.current = false; setExporting(false); }
    }
  };
  const [approvalDraft, setApprovalDraft] = useState(''), [approvalQuery, setApprovalQuery] = useState('');
  const [caseDraft, setCaseDraft] = useState(''), [approvalCase, setApprovalCase] = useState('');
  const [approvalLevel, setApprovalLevel] = useState(''), [approvalSort, setApprovalSort] = useState('newest');
  const invalidCase = caseDraft.trim() !== '' && (!/^[1-9][0-9]*$/.test(caseDraft.trim()) || !Number.isSafeInteger(Number(caseDraft.trim())));
  const [approvalPage, setApprovalPage] = useState(1), [approvalTotal, setApprovalTotal] = useState(0);
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
      apiClient.get('/response-plans/', { params: { page, size: 20, ...(statusFilter ? { status: statusFilter } : {}), ...(historyQuery ? { query: historyQuery } : {}), ...(historyCase ? { case_id: Number(historyCase) } : {}), ...(historyLevel ? { autonomy_level: historyLevel } : {}), ...(historySort !== 'newest' ? { sort: historySort } : {}) } }),
      apiClient.get('/response-plans/pending-approvals', { params: { page: approvalPage, size: 10, ...(approvalQuery ? { query: approvalQuery } : {}), ...(approvalCase ? { case_id: Number(approvalCase) } : {}), ...(approvalLevel ? { autonomy_level: approvalLevel } : {}), ...(approvalSort !== 'newest' ? { sort: approvalSort } : {}) } }),
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
    if (approvalResult.status === 'fulfilled') {
      const data = approvalResult.value.data;
      const count = typeof data.total === 'number' ? data.total : (data.data || []).length;
      if (!Array.isArray(data.data) || !Number.isSafeInteger(count) || count < 0 || (data.page !== undefined && data.page !== approvalPage) || (data.size !== undefined && data.size !== 10)) {
        setPending([]); setApprovalTotal(0); nextErrors.push('The approval response did not match the requested page. Retry before making a decision.');
      } else {
        const lastPage = Math.max(1, Math.ceil(count / 10));
        if (approvalPage > lastPage) { setApprovalPage(lastPage); return; }
        setPending(data.data); setApprovalTotal(count);
      }
    }
    else { setPending([]); setApprovalTotal(0); nextErrors.push(getApiErrorMessage(approvalResult.reason, 'Pending approvals could not be loaded.')); }
    setErrors(nextErrors);
    setLoading(false);
  }, [statusFilter, page, approvalPage, approvalQuery, approvalCase, approvalLevel, approvalSort, historyQuery, historyCase, historyLevel, historySort]);

  const approvePlan = async (planId: number) => {
    if (approving.current || workingPlan !== null || loading || errors.length || !pending.some(item => item.plan_id === planId && item.id === reviewApprovalId)) return;
    const reviewedFingerprint = pending.find(item => item.id === reviewApprovalId)?.review_fingerprint;
    if (!reviewedFingerprint || !/^[a-f0-9]{64}$/.test(reviewedFingerprint)) { setApprovalError('Refresh the approval queue to load a verifiable plan review.'); return; }
    approving.current = true;
    setApprovalError('');
    setWorkingPlan(planId);
    try {
      const response = await apiClient.post(`/response-plans/${planId}/approve`, { reviewed_fingerprint: reviewedFingerprint });
      if (response.data?.success !== true || response.data?.plan_status !== 'approved') {
        setApprovalError('Approval returned without a confirmed approved state. Refresh and review the current plan before trying again.');
        setReviewApprovalId(null);
        await fetchPlans();
        return;
      }
      setReviewApprovalId(null);
      toast('Plan approved', 'success');
      await fetchPlans();
    } catch (err) {
      setApprovalError(getApiErrorMessage(err, 'Approval could not be confirmed. Review the current plan before retrying.'));
      if (isAxiosError(err) && err.response?.status === 409) { setReviewApprovalId(null); await fetchPlans(); }
    }
    finally { approving.current = false; setWorkingPlan(null); }
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
      const simulated = outcome?.execution_mode === 'simulated';
      const allSucceeded = verified && simulated && outcome.status === 'completed' && outcome.failed === 0;
      const text = verified
        ? `Plan #${planId} reported ${outcome.succeeded} of ${outcome.total_actions} actions succeeded; ${outcome.failed} failed or skipped. Recorded status: ${outcome.status}. ${simulated ? 'Simulation only. No external action was performed.' : 'Execution mode not verified. These counts do not establish external action.'}`
        : `Execution request for plan #${planId} returned without a verifiable outcome. Review the refreshed plan before trying any action again.`;
      setExecutionNotice({ text, success: !!allSucceeded });
      toast(allSucceeded ? `Plan #${planId}: all simulated actions succeeded. No external action performed.` : `Plan #${planId}: review execution outcome.`, allSucceeded ? 'success' : 'warning');
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
      <PageHeader eyebrow="Act" title="Response Plans" description="Review saved plans and approval records. Built-in action handlers run simulations, not external containment or notifications." />

      {approvalError && <p role="alert" className="rounded border border-warning/40 p-3 text-sm text-warning">{approvalError}</p>}
      {executionNotice && <p role={executionNotice.success ? 'status' : 'alert'} className={`rounded-md border p-4 text-sm ${executionNotice.success ? 'border-success/30 text-success' : 'border-warning/30 text-warning'}`}>{executionNotice.text}</p>}
      {errors.length > 0 && (plans.length > 0 || pending.length > 0)
        ? <DegradedBanner messages={errors} onRetry={() => void fetchPlans()} />
        : errors.length > 0 && <ErrorState title="Response plans unavailable" description={errors.join(' · ')} action={<RetryButton onClick={() => void fetchPlans()} />} />}
      {loading && <LoadingSurface label="Loading response plans" />}

      <ResponseDecisionEvidence key={evidenceVersion} linkedPlanId={linkedPlanId} />
      {linkedPlanId && /^[1-9][0-9]*$/.test(linkedPlanId) && Number.isSafeInteger(Number(linkedPlanId)) && <ResponseDraftApproval planId={Number(linkedPlanId)} onApproved={() => { setEvidenceVersion(value => value + 1); void fetchPlans(); }} />}
      <ResponsePlanComparison baseline={compareFrom} comparison={compareTo} />

      {/* Pending Approvals */}
      {(
        <div className="bg-warning/5 border border-warning/30 rounded-md p-6">
          <h2 className="text-lg font-semibold text-warning mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Pending Approvals ({approvalTotal})
          </h2>
          <p className="mb-3 text-xs text-surface-400">Pending request records matching the applied queue filters, across all pages. Approving a plan resolves all of its pending requests, including records on other pages. Review the complete saved plan before deciding.</p>
          <form className="mb-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (invalidCase || workingPlan !== null) return; setApprovalQuery(approvalDraft.trim()); setApprovalCase(caseDraft.trim()); setApprovalPage(1); setReviewApprovalId(null); setApprovalError(''); }}>
            <label className="flex min-w-0 flex-1 basis-full flex-col gap-1 text-xs text-surface-400 sm:basis-0">Search all pending requests<input aria-label="Search all pending approvals" maxLength={200} value={approvalDraft} disabled={workingPlan !== null} onChange={event => setApprovalDraft(event.target.value)} placeholder="Reason, requester or record ID" className="min-w-0 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100" /></label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-surface-400">Exact investigation ID<input aria-label="Approval investigation ID" inputMode="numeric" maxLength={16} value={caseDraft} disabled={workingPlan !== null} onChange={event => setCaseDraft(event.target.value)} placeholder="Any investigation" className="min-w-0 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100" /></label>
            <button type="submit" disabled={workingPlan !== null || invalidCase} className="self-end rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Search approval queue</button>
          </form>
          {invalidCase && <p role="alert" className="mb-3 text-xs text-warning">Use one positive whole-number investigation ID. This draft has not been applied.</p>}
          {(approvalDraft.trim() !== approvalQuery || caseDraft.trim() !== approvalCase) && <p className="mb-3 text-xs text-warning">Queue search draft not applied. Current results use keyword {approvalQuery ? `"${approvalQuery}"` : 'any'} and investigation {approvalCase ? `#${approvalCase}` : 'any'}.</p>}
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="flex flex-col gap-1 text-xs text-surface-400">Saved autonomy level<select aria-label="Approval autonomy level" disabled={workingPlan !== null} value={approvalLevel} onChange={event => { setApprovalLevel(event.target.value); setApprovalPage(1); setReviewApprovalId(null); }} className="max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200"><option value="">All levels</option>{['L0','L1','L2','L3','L4'].map(level => <option key={level} value={level}>{level}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs text-surface-400">Request order<select aria-label="Approval request order" disabled={workingPlan !== null} value={approvalSort} onChange={event => { setApprovalSort(event.target.value); setApprovalPage(1); setReviewApprovalId(null); }} className="max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200"><option value="newest">Newest requested first</option><option value="oldest">Oldest requested first</option></select></label>
            <button type="button" disabled={workingPlan !== null} onClick={() => { setApprovalDraft(''); setApprovalQuery(''); setCaseDraft(''); setApprovalCase(''); setApprovalLevel(''); setApprovalSort('newest'); setApprovalPage(1); setReviewApprovalId(null); }} className="self-end rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Clear approval queue filters</button>
            <button type="button" disabled={loading || workingPlan !== null} onClick={() => { setReviewApprovalId(null); setApprovalError(''); void fetchPlans(); }} className="self-end rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Refresh approval queue</button>
          </div>
          {!loading && !errors.length && !pending.length && <p role="status" className="mb-3 text-sm text-surface-300">No pending approval requests match the applied queue filters. This is not a count of executable plans or evidence of external action.</p>}
          <p className="mb-3 text-xs text-surface-400">Search covers saved request reasons, requesters and approval/plan/investigation IDs, not action contents. Dates are request timestamps. Counts and pages can change between reads. Queue filters do not restrict the plan-wide effects of an approval.</p>
          <div className="space-y-3">
            {pending.map(a => (
              <div key={a.id} className="min-w-0 rounded-lg bg-surface-900/50 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-surface-50 font-medium">Plan #{a.plan_id} — Case #{a.case_id}</p>
                  <p className="mt-1 break-words text-xs text-surface-400">{a.reason?.trim() ? a.reason : 'Reason not recorded'}</p>
                  <p className="mt-1 break-words text-xs text-surface-500">Request #{a.id} · Requester: {a.requested_by ?? 'Not recorded'} · Saved plan state: {a.plan_status ?? 'Not returned'} · Requested: {a.created_at ? new Date(a.created_at).toLocaleString() : 'Not recorded'}</p>
                  <p className="text-xs text-surface-500 mt-1">
                    {a.actions?.length || 0} {a.actions?.length === 1 ? 'action' : 'actions'} · Autonomy {a.autonomy_level}
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
                {!loading && !errors.length && reviewApprovalId === a.id && <ResponseApprovalReview reviewFingerprint={a.review_fingerprint} key={JSON.stringify(a)} planId={a.plan_id} caseId={a.case_id} actions={a.actions || []} busy={workingPlan !== null} onApprove={() => void approvePlan(a.plan_id)} onCancel={() => { if (workingPlan === null) setReviewApprovalId(null); }} />}
              </div>
            ))}
          </div>
          <nav aria-label="Pending approval request pages" className="mt-4 flex flex-wrap items-center gap-2 text-xs text-surface-300">
            <button type="button" disabled={loading || workingPlan !== null || approvalPage === 1} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40" onClick={() => { setReviewApprovalId(null); setApprovalPage(approvalPage - 1); }}>Previous approval page</button>
            <span>Approval page {approvalPage} of {Math.max(1, Math.ceil(approvalTotal / 10))} · Records on this page: {pending.length}</span>
            <button type="button" disabled={loading || workingPlan !== null || approvalPage * 10 >= approvalTotal} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40" onClick={() => { setReviewApprovalId(null); setApprovalPage(approvalPage + 1); }}>Next approval page</button>
          </nav>
        </div>
      )}

      {/* Plans Table */}
      <div className="oa-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-surface-50">All Response Plans</h2>
          <div className="flex flex-wrap items-center gap-3">
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
        <form aria-label="Search response plan history" className="mb-3 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (invalidHistoryCase) return; setHistoryQuery(historyDraft.trim()); setHistoryCase(historyCaseDraft.trim()); setPage(1); setSelectedPlanId(null); }}>
          <label className="min-w-0 text-xs text-surface-300">Plan ID, investigation ID or creator<input aria-label="Search plan history" maxLength={200} value={historyDraft} onChange={event => setHistoryDraft(event.target.value)} className="mt-1 block w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm" /></label>
          <label className="min-w-0 text-xs text-surface-300">Exact investigation ID<input aria-label="Plan history investigation ID" inputMode="numeric" value={historyCaseDraft} onChange={event => setHistoryCaseDraft(event.target.value)} className="mt-1 block w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm" /></label>
          <button type="submit" disabled={invalidHistoryCase} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Search plan history</button>
          <label className="text-xs text-surface-300">Autonomy level<select aria-label="Filter plan history autonomy" value={historyLevel} onChange={event => { setHistoryLevel(event.target.value); setPage(1); setSelectedPlanId(null); }} className="mt-1 block rounded border border-surface-600 bg-surface-950 p-2 text-sm"><option value="">All levels</option>{['L0', 'L1', 'L2', 'L3', 'L4'].map(level => <option key={level}>{level}</option>)}</select></label>
          <label className="text-xs text-surface-300">Order<select aria-label="Order plan history" value={historySort} onChange={event => { setHistorySort(event.target.value); setPage(1); setSelectedPlanId(null); }} className="mt-1 block rounded border border-surface-600 bg-surface-950 p-2 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
          <button type="button" onClick={() => { setHistoryDraft(''); setHistoryQuery(''); setHistoryCaseDraft(''); setHistoryCase(''); setHistoryLevel(''); setHistorySort('newest'); setStatusFilter(''); setPage(1); setSelectedPlanId(null); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-300">Clear plan history filters</button>
        </form>
        {invalidHistoryCase && <p role="alert" className="mb-3 text-xs text-danger">Use one positive whole-number investigation ID. The draft has not been applied.</p>}
        {(historyDraft.trim() !== historyQuery || historyCaseDraft.trim() !== historyCase) && <p className="mb-3 text-xs text-warning">Plan history search draft not applied. Results and CSV still use keyword {historyQuery ? `"${historyQuery}"` : 'any'} and investigation {historyCase ? `#${historyCase}` : 'any'}.</p>}
        <p className="mb-3 break-words text-xs text-surface-400">{total} matching plan records across all pages. Literal case-insensitive search covers plan IDs, investigation IDs and creators, not action text. CSV includes all matching plan metadata in this order, not action targets or execution details. This is a new current read, not a frozen snapshot. Changing applied filters cancels a pending download. Approval queue filters above are separate.</p>
        {exportError && <p role="alert" className="mb-3 text-xs text-danger">{exportError}</p>}
        {plans.length === 0 ? (
          !loading && errors.length === 0 && <EmptyState title="No response plans" description="No saved plan matches the applied filters. Clear filters to review all plans." />
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
                      {p.status === 'draft' && <a className="inline-block rounded border border-surface-600 px-2 py-1 text-xs text-primary-300" onClick={event => event.stopPropagation()} href={`/app/response-plans?plan=${p.id}`}>Review draft #{p.id}</a>}
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
            {selectedPlan.actions?.map((action, i) => action && typeof action === 'object' && !Array.isArray(action) ? (
              <div key={i} className="min-w-0 space-y-3 rounded-lg border border-surface-700 bg-surface-900/50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-mono text-surface-500">Position {i + 1}, recorded priority: {recordedValueText(action.priority)}</span>
                  <span className={clsx('break-all text-xs px-2 py-0.5 rounded font-medium',
                    action.policy_check?.approved === true ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                    {recordedValueText(action.action_type)}
                  </span>
                  <span className="min-w-0 break-all text-sm text-surface-300">{recordedValueText(action.target)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-xs text-surface-400">{recordedValueText(action.reason, 'No action reason recorded.')}</p>
                <dl className="space-y-2 border-t border-surface-700 pt-3 text-sm">
                  <div><dt className="text-xs text-surface-400">Recorded execution status</dt><dd className={action.execution_result?.status === 'completed' ? 'text-success' : 'text-surface-200'}>{recordedValueText(action.execution_result?.status, 'No execution result recorded')}</dd></div>
                  {action.execution_result && <>
                    <div><dt className="text-xs text-surface-400">Recorded execution mode</dt><dd className="text-warning">{action.execution_result.execution_mode === 'simulated' ? 'Simulated, no external action performed' : 'Not verified, external action not established'}</dd></div>
                    <div><dt className="text-xs text-surface-400">Recorded execution detail</dt><dd className="whitespace-pre-wrap break-words text-surface-300">{recordedValueText(action.execution_result.detail, 'No execution detail recorded.')}</dd></div>
                    <div><dt className="text-xs text-surface-400">Recorded execution time</dt><dd className="break-words text-surface-300">{typeof action.execution_result.executed_at === 'string' && action.execution_result.executed_at && !Number.isNaN(Date.parse(action.execution_result.executed_at)) ? new Date(action.execution_result.executed_at).toLocaleString() : recordedValueText(action.execution_result.executed_at)}</dd></div>
                  </>}
                </dl>
              </div>
            ) : <p key={i} role="alert" className="text-sm text-warning">Action position {i + 1} has a malformed saved record. No execution result is inferred.</p>)}
          </div>
        </div>
      )}

      {confirmAction?.type === 'execute' && (
        <ConfirmDialog
          title={`Execute plan #${confirmAction.planId}?`}
          description="The built-in handlers simulate actions and record results. They do not notify responders, create tickets, isolate hosts, block traffic or change accounts. Review the returned execution mode; historical results without a mode are unverified."
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
      {confirmAction?.type === 'reject' && <ResponseRejectionReview key={confirmAction.planId} planId={confirmAction.planId} onCancel={() => setConfirmAction(null)} onRejected={() => { setEvidenceVersion(value => value + 1); void fetchPlans(); }} />}
    </div>
  );
}
