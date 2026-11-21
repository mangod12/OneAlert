import { ComplianceAssessmentReview } from '../components/ComplianceAssessmentReview';
import { AssessmentComparison } from '../components/AssessmentComparison';
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { Download, FileText, ShieldCheck } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { toast } from '../components/Toast';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useDialogFocus } from '../components/ui/useDialogFocus';

interface Framework {
  id: number;
  name: string;
  version: string;
  description: string | null;
}

interface ComplianceSummary {
  framework_id: number;
  framework_name: string;
  total_controls: number;
  compliant: number;
  non_compliant: number;
  partial: number;
  not_assessed: number;
  not_applicable?: number;
  compliance_percentage: number;
}

interface Control {
  id: number;
  framework_id: number;
  control_id: string;
  title: string;
  description: string | null;
  category: string | null;
}

interface Assessment {
  id: number;
  control_id: number;
  status: string;
  evidence_type: string | null;
  evidence_detail: string | null;
  assessed_at: string;
  assessed_by: string;
}

const statusTones: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  compliant: 'success',
  non_compliant: 'danger',
  partial: 'warning',
  not_applicable: 'neutral',
  not_assessed: 'neutral',
};

const statusLabels: Record<string, string> = {
  compliant: 'Compliant',
  non_compliant: 'Non-compliant',
  partial: 'Partial',
  not_applicable: 'Not applicable',
  not_assessed: 'Not assessed',
};

const assessmentStatuses = ['compliant', 'partial', 'non_compliant', 'not_applicable', 'not_assessed'] as const;

const evidenceTypes = [
  { value: 'manual', label: 'Manual review' },
  { value: 'automated', label: 'Automated check' },
  { value: 'document', label: 'Document' },
] as const;

function EvidenceDialog({ assessment, control, onClose, onSaved }: {
  assessment: Assessment | null;
  control: Control;
  onClose: () => void;
  onSaved: (updated: Assessment) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [reviewStatus, setReviewStatus] = useState(assessment?.status ?? 'not_assessed');
  const [evidenceType, setEvidenceType] = useState(assessment ? assessment.evidence_type ?? '' : 'manual');
  const [evidenceDetail, setEvidenceDetail] = useState(assessment?.evidence_detail ?? '');
  const [saving, setSaving] = useState(false);
  useDialogFocus(dialogRef, onClose);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        status: reviewStatus,
        evidence_type: evidenceType || null,
        evidence_detail: evidenceDetail.trim() || null,
      };
      const res = assessment
        ? await apiClient.patch<Assessment>(`/compliance/assessments/${assessment.id}`, payload)
        : await apiClient.post<Assessment>(`/compliance/controls/${control.id}/assessments`, payload);
      toast('Evidence saved.', 'success');
      onSaved(res.data);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'Evidence could not be saved.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/70" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Evidence for ${control.control_id}`}
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-surface-50">Evidence for {control.control_id}</h2>
        <p className="mt-0.5 text-xs text-surface-500">{control.title}</p>
        <div className="mt-4 space-y-3">
          {!assessment && <>
            <p className="text-xs text-surface-400">Record your review of this control. Saving does not run an automated assessment.</p>
            <label className="block text-xs font-medium text-surface-300">Review status
              <select aria-label="Review status" value={reviewStatus} onChange={event => setReviewStatus(event.target.value)}
                className="mt-1 w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
                {assessmentStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
              </select>
            </label>
          </>}
          <div>
            <label htmlFor="evidence-type" className="mb-1 block text-xs font-medium text-surface-300">Evidence type</label>
            <select id="evidence-type" value={evidenceType} onChange={e => setEvidenceType(e.target.value)}
              className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
              <option value="">None</option>
              {evidenceTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="evidence-detail" className="mb-1 block text-xs font-medium text-surface-300">Details</label>
            <textarea id="evidence-detail" rows={4} value={evidenceDetail} onChange={e => setEvidenceDetail(e.target.value)}
              placeholder="What supports this assessment, for example a policy link, scan report or review note."
              className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => void save()} disabled={saving}
              className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">
              {saving ? 'Saving...' : assessment ? 'Save evidence' : 'Save manual assessment'}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssessmentHistoryDialog({ control, history, onClose }: { control: Control; history: Assessment[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialogRef, onClose);
  const [page, setPage] = useState(1);
  const [comparison, setComparison] = useState<number[]>([]);
  const sorted = [...history].sort((a, b) => b.assessed_at.localeCompare(a.assessed_at) || b.id - a.id);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-surface-950/70" onClick={onClose} aria-hidden="true" />
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Assessment history for ${control.control_id}`}
      className="relative max-h-[85vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold text-surface-50">Assessment history: {control.control_id}</h2>
        <button type="button" onClick={onClose} className="rounded border border-surface-600 px-3 py-1 text-xs text-surface-300">Close history</button></div>
      <p className="text-xs text-surface-400">{sorted.length} saved records for this control. New reviews keep earlier records. Edits to an existing record are not a separate audit history.</p>
      <AssessmentComparison controlId={control.id} ids={comparison} />
      {comparison.length > 0 && <button type="button" className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-300" onClick={() => setComparison([])}>Clear assessment comparison selection</button>}
      <nav aria-label="Assessment history pages" className="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-300">
        <span>Page {page} of {Math.max(1, Math.ceil(sorted.length / 10))}</span><div className="flex gap-2">
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded border border-surface-600 px-2 py-1 disabled:opacity-40">Previous records</button>
          <button type="button" disabled={page * 10 >= sorted.length} onClick={() => setPage(page + 1)} className="rounded border border-surface-600 px-2 py-1 disabled:opacity-40">More records</button>
        </div>
      </nav>
      <ol className="space-y-3">{sorted.slice((page - 1) * 10, page * 10).map((record, index) => <li key={record.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300">
        <label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" aria-label={`Select assessment ${record.id} for comparison`} checked={comparison.includes(record.id)} disabled={comparison.length === 2 && !comparison.includes(record.id)} onChange={event => setComparison(ids => event.target.checked ? [...ids, record.id] : ids.filter(id => id !== record.id))} />Select for comparison</label>
        <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={statusTones[record.status] ?? 'neutral'}>{statusLabels[record.status] ?? record.status}</StatusBadge><span>{page === 1 && index === 0 ? 'Latest saved record' : 'Earlier saved record'} · #{record.id}</span></div>
        <p className="break-words">{record.assessed_by} · {new Date(record.assessed_at).toLocaleString()}</p>
        <p>Evidence type: {record.evidence_type || 'Not recorded'}</p>
        <p className="whitespace-pre-wrap break-words">{record.evidence_detail || 'No evidence detail recorded.'}</p>
      </li>)}</ol>
    </section>
  </div>;
}

export function Compliance() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [summaries, setSummaries] = useState<ComplianceSummary[]>([]);
  const summaryRequestId = useRef(0);
  const [summaryError, setSummaryError] = useState('');
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controlsRequestId = useRef(0);
  const selectedFramework = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [controls, setControls] = useState<Control[]>([]);
  const [assessmentHistory, setAssessmentHistory] = useState<Assessment[]>([]);
  const [historyTarget, setHistoryTarget] = useState<Control | null>(null);
  const [assessments, setAssessments] = useState<Map<number, Assessment>>(new Map());
  const [controlsLoading, setControlsLoading] = useState(false);
  const [controlsError, setControlsError] = useState('');
  const [controlSearch, setControlSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [evidenceTarget, setEvidenceTarget] = useState<{ assessment: Assessment | null; control: Control; initialStatus?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportRequest = useRef(0), exportBusy = useRef(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => { exportRequest.current += 1; exportBusy.current = false; setExporting(false); setExportError(''); return () => { exportRequest.current += 1; }; }, [selected, controlSearch, statusFilter]);
  const [assessing, setAssessing] = useState(false);

  const exportCsv = async () => {
    if (exportBusy.current || selected == null) return;
    exportBusy.current = true; const request = ++exportRequest.current;
    setExportError('');
    setExporting(true);
    try {
      const res = await apiClient.get('/compliance/export', {
        params: { framework_id: String(selected), ...(controlSearch.trim() ? { query: controlSearch.trim() } : {}), ...(statusFilter ? { status: statusFilter } : {}) },
        responseType: 'blob',
      });
      if (request !== exportRequest.current) return;
      if (!(res.data instanceof Blob) || !res.data.type.startsWith('text/csv')) throw new Error('The server did not return compliance CSV. No file was downloaded.');
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `compliance-${selected}.csv`;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
    } catch (err: unknown) {
      if (request !== exportRequest.current) return;
      const response = (err as {response?: {data?: unknown}} | null)?.response;
      if (response?.data instanceof Blob) { try { response.data = JSON.parse(await response.data.text()); } catch { /* Use the standard fallback. */ } }
      if (request === exportRequest.current) setExportError(getApiErrorMessage(err, 'Compliance export unavailable. No file was downloaded.'));
    } finally {
      if (request === exportRequest.current) { exportBusy.current = false; setExporting(false); }
    }
  };

  const filteredControls = controls.filter(control => {
    const effectiveStatus = assessments.get(control.id)?.status ?? 'not_assessed';
    if (statusFilter && effectiveStatus !== statusFilter) return false;
    if (controlSearch.trim()) {
      const needle = controlSearch.trim().toLowerCase();
      return control.control_id.toLowerCase().includes(needle) || control.title.toLowerCase().includes(needle);
    }
    return true;
  });

  const refreshSummary = async () => {
    const request = ++summaryRequestId.current;
    setSummaryRefreshing(true);
    setSummaryError('');
    try {
      const res = await apiClient.get<ComplianceSummary[]>('/compliance/summary');
      if (request === summaryRequestId.current) setSummaries(res.data);
    } catch (err: unknown) {
      if (request === summaryRequestId.current) setSummaryError(getApiErrorMessage(err, 'Updated posture could not be loaded.'));
    } finally {
      if (request === summaryRequestId.current) setSummaryRefreshing(false);
    }
  };

  const fetchOverview = useCallback(async () => {
    ++summaryRequestId.current;
    setSummaryError('');
    setSummaryRefreshing(false);
    setLoading(true);
    setError('');
    try {
      const [frameworksRes, summaryRes] = await Promise.all([
        apiClient.get<Framework[]>('/compliance/frameworks'),
        apiClient.get<ComplianceSummary[]>('/compliance/summary'),
      ]);
      setFrameworks(frameworksRes.data);
      setSummaries(summaryRes.data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Compliance posture could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchOverview(); return () => { controlsRequestId.current += 1; summaryRequestId.current += 1; }; }, [fetchOverview]);

  const loadControls = async (frameworkId: number) => {
    const request = ++controlsRequestId.current;
    setControls([]); setAssessments(new Map()); setAssessmentHistory([]);
    setControlsLoading(true);
    setControlsError('');
    try {
      const [controlsRes, assessmentsRes] = await Promise.all([
        apiClient.get<Control[]>(`/compliance/frameworks/${frameworkId}/controls`),
        apiClient.get<Assessment[]>('/compliance/assessments'),
      ]);
      if (request !== controlsRequestId.current || selectedFramework.current !== frameworkId) return;
      setControls(controlsRes.data);
      const latest = new Map<number, Assessment>();
      for (const assessment of assessmentsRes.data) {
        const existing = latest.get(assessment.control_id);
        if (!existing || (existing.assessed_at < assessment.assessed_at || (existing.assessed_at === assessment.assessed_at && existing.id < assessment.id))) latest.set(assessment.control_id, assessment);
      }
      setAssessments(latest);
      setAssessmentHistory(assessmentsRes.data);
    } catch (err: unknown) {
      if (request !== controlsRequestId.current || selectedFramework.current !== frameworkId) return;
      setControls([]);
      setAssessments(new Map());
      setAssessmentHistory([]);
      setControlsError(getApiErrorMessage(err, 'Framework controls could not be loaded.'));
    } finally {
      if (request === controlsRequestId.current) setControlsLoading(false);
    }
  };

  const openFramework = async (frameworkId: number) => {
    controlsRequestId.current += 1;
    setEvidenceTarget(null); setHistoryTarget(null);
    if (selected === frameworkId) { selectedFramework.current = null; setSelected(null); return; }
    selectedFramework.current = frameworkId;
    setSelected(frameworkId);
    await loadControls(frameworkId);
  };

  const runAssessment = async () => {
    if (assessing) return;
    setAssessing(true);
    try {
      const res = await apiClient.post<{ data?: { total?: number } }>('/compliance/assess');
      const total = res.data?.data?.total;
      toast(total != null ? `Automated assessment updated ${total} controls.` : 'Automated assessment completed.', 'success');
      await fetchOverview();
      if (selectedFramework.current != null) await loadControls(selectedFramework.current);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The automated assessment could not be run.'), 'error');
    } finally {
      setAssessing(false);
    }
  };

  const changeStatus = (assessment: Assessment, status: string) => {
    const control = controls.find(row => row.id === assessment.control_id);
    if (control && assessment.status !== status) setEvidenceTarget({ assessment, control, initialStatus: status });
  };

  if (loading) return <LoadingSurface rows={4} label="Loading compliance posture" />;
  if (error) return <ErrorState title="Compliance unavailable" description={error} action={<RetryButton onClick={() => void fetchOverview()} />} />;

  const summaryFor = (id: number) => summaries.find(s => s.framework_id === id);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Govern" title="Compliance" description="Control coverage and assessment posture across your frameworks." actions={
        <button
          type="button"
          onClick={() => void runAssessment()}
          disabled={assessing}
          className="flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
        >
          {assessing ? 'Running assessment…' : 'Run automated assessment'}
        </button>
      } />

      {summaryRefreshing && <p role="status" className="text-sm text-surface-400">Refreshing saved compliance posture...</p>}
      {summaryError && <div role="alert" className="rounded border border-warning/40 p-3 text-sm text-warning">
        Assessment was saved, but the cards may be out of date. {summaryError}
        <button type="button" onClick={() => void refreshSummary()} disabled={summaryRefreshing}
          className="ml-2 rounded border border-surface-600 px-3 py-1 text-xs disabled:opacity-40">Retry posture</button>
      </div>}
      {frameworks.length === 0 ? (
        <div className="oa-panel p-12 text-center text-surface-500">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No compliance frameworks are configured yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {frameworks.map(framework => {
            const summary = summaryFor(framework.id);
            const pct = summary ? Math.round(summary.compliance_percentage) : 0;
            const isOpen = selected === framework.id;
            return (
              <button
                key={framework.id}
                type="button"
                onClick={() => void openFramework(framework.id)}
                aria-expanded={isOpen}
                className={`oa-panel rounded-md p-5 text-left transition-colors hover:border-primary-500/40 ${isOpen ? 'border-primary-500/50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-surface-50">{framework.name}</h2>
                    <p className="text-xs text-surface-500 mt-0.5">{framework.version}</p>
                  </div>
                  <span className="text-2xl font-bold text-primary-400">{pct}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${framework.name} compliance`}
                  className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-700"
                >
                  <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-surface-500">Compliant controls / all framework controls. Latest saved assessment per control.</p>
                {summary && (
                  <p className="mt-2 text-xs text-surface-400">
                    {summary.compliant} compliant · {summary.partial} partial · {summary.non_compliant} non-compliant · {summary.not_assessed} not assessed{summary.not_applicable ? ` · ${summary.not_applicable} not applicable` : ''}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected != null && (
        <div className="oa-panel overflow-hidden rounded-md">
          {controlsLoading ? (
            <LoadingSurface rows={4} label="Loading framework controls" />
          ) : controlsError ? (
            <ErrorState title="Controls unavailable" description={controlsError} action={<RetryButton onClick={() => void loadControls(selected)} />} />
          ) : (
            <>
            <div className="flex flex-wrap items-center gap-3 border-b border-surface-700 px-4 py-3">
              <input
                type="text"
                aria-label="Search controls"
                maxLength={200}
                placeholder="Search by ID or title"
                value={controlSearch}
                onChange={(e) => setControlSearch(e.target.value)}
                className="w-64 rounded-md border border-surface-600 bg-surface-950 px-3 py-1.5 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <select
                aria-label="Filter controls by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-md border border-surface-600 bg-surface-950 px-2 py-1.5 text-sm text-surface-100"
              >
                <option value="">All statuses</option>
                {assessmentStatuses.map(status => (
                  <option key={status} value={status}>{statusLabels[status] ?? status}</option>
                ))}
              </select>
              <span className="text-xs text-surface-500">{filteredControls.length} of {controls.length} controls</span>
              <button
                type="button"
                onClick={() => { void exportCsv(); }}
                disabled={exporting}
                className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs text-surface-200 hover:bg-surface-800 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>
            <p className="px-4 pb-3 text-xs text-surface-400">CSV includes all controls matching this framework, title/control-ID search and latest assessment status, up to 5,000 controls. Larger requests are refused without a partial file. Evidence and assessor names are included. This is a new current read of your assessments, not a frozen copy or audit history. Keep the file within an appropriate audience. Changing filters cancels a pending download.</p>
            {exportError && <p role="alert" className="px-4 pb-3 text-sm text-danger">{exportError}</p>}
            <div role="region" aria-label="Framework controls" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-surface-400">
                  <th className="px-4 py-3 text-left">Control</th>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Evidence</th>
                  <th className="px-4 py-3 text-left">Assessed</th>
                </tr>
              </thead>
              <tbody>
                {filteredControls.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-surface-500">{controls.length === 0 ? 'No controls in this framework.' : 'No controls match the current filters.'}</td>
                  </tr>
                ) : (
                  filteredControls.map(control => {
                    const assessment = assessments.get(control.id);
                    return (
                      <tr key={control.id} className="border-b border-surface-700/50 hover:bg-surface-800 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-primary-300">{control.control_id}</td>
                        <td className="px-4 py-3 text-surface-200">{control.title}</td>
                        <td className="px-4 py-3 text-surface-400 text-xs">{control.category ?? '-'}</td>
                        <td className="px-4 py-3">
                          {assessment ? (
                            <label className="flex items-center gap-2">
                              <StatusBadge tone={statusTones[assessment.status] ?? 'neutral'}>
                                {statusLabels[assessment.status] ?? assessment.status}
                              </StatusBadge>
                              <select
                                aria-label={`Set status for ${control.control_id}`}
                                value={assessment.status}
                                disabled={!!evidenceTarget}
                                onChange={(e) => void changeStatus(assessment, e.target.value)}
                                className="rounded border border-surface-700 bg-surface-950 px-1.5 py-1 text-xs text-surface-300 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-40"
                              >
                                {assessmentStatuses.map(status => (
                                  <option key={status} value={status}>{statusLabels[status]}</option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <StatusBadge tone="neutral">Not assessed</StatusBadge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {assessment ? (
                            <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              aria-label={`Edit evidence for ${control.control_id}`}
                              onClick={() => setEvidenceTarget({ assessment, control })}
                              className={`inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors ${
                                assessment.evidence_detail
                                  ? 'border-primary-500/40 text-primary-300 hover:bg-primary-500/10'
                                  : 'border-surface-600 text-surface-300 hover:bg-surface-800'
                              }`}
                            >
                              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                              {assessment.evidence_detail ? 'View / edit' : 'Add evidence'}
                            </button>
                            <button type="button" aria-label={`New review for ${control.control_id}`} onClick={() => setEvidenceTarget({ assessment: null, control })}
                              className="min-h-8 rounded border border-surface-600 px-2.5 text-xs text-surface-300">New review</button>
                            <button type="button" aria-label={`Assessment history for ${control.control_id}`} onClick={() => setHistoryTarget(control)}
                              className="min-h-8 rounded border border-surface-600 px-2.5 text-xs text-surface-300">History ({assessmentHistory.filter(row => row.control_id === control.id).length})</button>
                            </div>
                          ) : (
                            <button type="button" aria-label={`Assess control ${control.control_id}`}
                              onClick={() => setEvidenceTarget({ assessment: null, control })}
                              className="min-h-8 rounded border border-surface-600 px-2.5 text-xs text-surface-300 hover:bg-surface-800">Assess control</button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-surface-500 text-xs">
                          {assessment ? new Date(assessment.assessed_at).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
            </>
          )}
        </div>
      )}
      {historyTarget && <AssessmentHistoryDialog key={historyTarget.id} control={historyTarget} history={assessmentHistory.filter(row => row.control_id === historyTarget.id)} onClose={() => setHistoryTarget(null)} />}
      {evidenceTarget?.assessment && <ComplianceAssessmentReview key={evidenceTarget.assessment.id}
        id={evidenceTarget.assessment.id} control={evidenceTarget.control} initialStatus={evidenceTarget.initialStatus}
        onClose={() => setEvidenceTarget(null)} onSaved={updated => {
          if (selectedFramework.current !== evidenceTarget.control.framework_id) return;
          setEvidenceTarget(null);
          setAssessmentHistory(current => current.map(row => row.id === updated.id ? updated : row));
          setAssessments(current => current.get(updated.control_id)?.id === updated.id ? new Map(current).set(updated.control_id, updated) : current);
          void refreshSummary();
        }} />}
      {evidenceTarget && !evidenceTarget.assessment && (
        <EvidenceDialog
          assessment={evidenceTarget.assessment}
          control={evidenceTarget.control}
          onClose={() => setEvidenceTarget(null)}
          onSaved={(updated) => {
            if (selectedFramework.current === evidenceTarget.control.framework_id) {
              setAssessments(current => new Map(current).set(updated.control_id, updated));
              setAssessmentHistory(current => [...current.filter(row => row.id !== updated.id), updated]);
              setEvidenceTarget(current => current === evidenceTarget ? null : current);
              if (!evidenceTarget.assessment) void refreshSummary();
            }
          }}
        />
      )}
    </div>
  );
}
