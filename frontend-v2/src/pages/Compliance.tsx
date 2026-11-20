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
  assessment: Assessment;
  control: Control;
  onClose: () => void;
  onSaved: (updated: Assessment) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [evidenceType, setEvidenceType] = useState(assessment.evidence_type ?? '');
  const [evidenceDetail, setEvidenceDetail] = useState(assessment.evidence_detail ?? '');
  const [saving, setSaving] = useState(false);
  useDialogFocus(dialogRef, onClose);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiClient.patch<Assessment>(`/compliance/assessments/${assessment.id}`, {
        status: assessment.status,
        evidence_type: evidenceType || null,
        evidence_detail: evidenceDetail.trim() || null,
      });
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
              {saving ? 'Saving...' : 'Save evidence'}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
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
  const [assessments, setAssessments] = useState<Map<number, Assessment>>(new Map());
  const [controlsLoading, setControlsLoading] = useState(false);
  const [controlsError, setControlsError] = useState('');
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [controlSearch, setControlSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [evidenceTarget, setEvidenceTarget] = useState<{ assessment: Assessment; control: Control } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [assessing, setAssessing] = useState(false);

  const exportCsv = async () => {
    if (exporting || selected == null) return;
    setExporting(true);
    try {
      const res = await apiClient.get('/compliance/export', {
        params: { framework_id: String(selected) },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `compliance-${selected}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The export could not be downloaded.'), 'error');
    } finally {
      setExporting(false);
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
    setControls([]); setAssessments(new Map());
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
    } catch (err: unknown) {
      if (request !== controlsRequestId.current || selectedFramework.current !== frameworkId) return;
      setControls([]);
      setAssessments(new Map());
      setControlsError(getApiErrorMessage(err, 'Framework controls could not be loaded.'));
    } finally {
      if (request === controlsRequestId.current) setControlsLoading(false);
    }
  };

  const openFramework = async (frameworkId: number) => {
    controlsRequestId.current += 1;
    setEvidenceTarget(null);
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

  const changeStatus = async (assessment: Assessment, status: string) => {
    if (savingIds.has(assessment.id) || assessment.status === status) return;
    const frameworkId = selectedFramework.current;
    const previous = assessment.status;
    setSavingIds(current => new Set(current).add(assessment.id));
    setAssessments(current => new Map(current).set(assessment.control_id, { ...assessment, status }));
    try {
      await apiClient.patch(`/compliance/assessments/${assessment.id}`, { status });
      await refreshSummary();
    } catch (err: unknown) {
      if (selectedFramework.current === frameworkId) setAssessments(current => new Map(current).set(assessment.control_id, { ...assessment, status: previous }));
      toast(getApiErrorMessage(err, 'Assessment status could not be updated.'), 'error');
    } finally {
      setSavingIds(current => { const next = new Set(current); next.delete(assessment.id); return next; });
    }
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
        Status was saved, but the cards may be out of date. {summaryError}
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
            <table className="w-full text-sm">
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
                                disabled={savingIds.has(assessment.id)}
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
                              {assessment.evidence_detail ? 'View' : 'Add'}
                            </button>
                          ) : (
                            <span className="text-xs text-surface-600">-</span>
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
            </>
          )}
        </div>
      )}
      {evidenceTarget && (
        <EvidenceDialog
          assessment={evidenceTarget.assessment}
          control={evidenceTarget.control}
          onClose={() => setEvidenceTarget(null)}
          onSaved={(updated) => {
            if (selectedFramework.current === evidenceTarget.control.framework_id) {
              setAssessments(current => new Map(current).set(updated.control_id, updated));
              setEvidenceTarget(null);
            }
          }}
        />
      )}
    </div>
  );
}
