import { useCallback, useState, useEffect, useRef } from 'react';
import apiClient from '../api/client';
import { Play, Plus, ShieldCheck, Target, CheckCircle, XCircle, Trash2, Download } from 'lucide-react';
import clsx from 'clsx';
import { validationEvidenceCsv } from '../utils/validationEvidenceCsv';
import { toast } from '../components/Toast';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ValidationCoverageEvidence } from '../components/ValidationCoverageEvidence';
import { ValidationComparison } from '../components/ValidationComparison';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

interface RecordedControl {
  id: number;
  control_name: string;
  control_type: string;
  expected: boolean;
  detected: boolean;
  detection_time_ms: number | null;
  details: string | null;
}

interface ValidationStep {
  id: number;
  technique_id: string;
  test_name: string;
  actual_result: string | null;
  duration_ms: number | null;
  simulated?: boolean;
  status?: string;
  test_type?: string;
  technique_name?: string;
  executed_at?: string | null;
  controls?: RecordedControl[];
}
interface ValidationRunDetail extends ValidationRun { steps: ValidationStep[]; }

interface ValidationRun {
  id: number;
  name: string;
  description: string | null;
  status: string;
  mode: string;
  mitre_techniques: string[];
  results_summary: { tested: number; detected: number; missed: number; detection_rate: number } | null;
  created_at: string;
}

interface TechniqueCoverage {
  technique_id: string;
  technique_name: string;
  total_tests: number;
  detections: number;
  detection_rate: number;
}

const coverageTone = (rate: number) =>
  rate >= 70 ? 'text-success' : rate >= 40 ? 'text-warning' : 'text-danger';

const AVAILABLE_TECHNIQUES = [
  { id: 'T1059', name: 'Command and Scripting Interpreter' },
  { id: 'T1071', name: 'Application Layer Protocol' },
  { id: 'T1110', name: 'Brute Force' },
  { id: 'T1190', name: 'Exploit Public-Facing Application' },
  { id: 'T1078', name: 'Valid Accounts' },
  { id: 'T1021', name: 'Remote Services' },
  { id: 'T1046', name: 'Network Service Discovery' },
  { id: 'T1486', name: 'Data Encrypted for Impact' },
];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-surface-600/20 text-surface-400',
  running: 'bg-info/10 text-info',
  completed: 'bg-success/10 text-success',
  failed: 'bg-danger/10 text-danger',
};

export function Validation() {
  const listRequestId = useRef(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [coverage, setCoverage] = useState<TechniqueCoverage[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const detailRequestId = useRef(0);
  const requestedRunId = useRef<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRunId, setDetailRunId] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [selectedRun, setSelectedRun] = useState<ValidationRunDetail | null>(null);
  const [newRun, setNewRun] = useState({ name: '', description: '', techniques: [] as string[] });
  const [evidenceSearch, setEvidenceSearch] = useState('');
  const [evidencePage, setEvidencePage] = useState(1);
  const [resultFilter, setResultFilter] = useState<'all' | 'attention' | 'detected'>('all');
  const [runStatusFilter, setRunStatusFilter] = useState('');
  const [runSearchDraft, setRunSearchDraft] = useState(''), [runQuery, setRunQuery] = useState('');
  const [runMode, setRunMode] = useState(''), [runSort, setRunSort] = useState('newest');
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState<number | null>(null);
  const [confirmRunId, setConfirmRunId] = useState<number | null>(null);
  const [deletingRun, setDeletingRun] = useState<ValidationRun | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [exportingRun, setExportingRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [coverageError, setCoverageError] = useState('');
  const coverageRequest = useRef(0);
  const [coverageRetrying, setCoverageRetrying] = useState(false);
  const retryCoverage = async () => {
    const request = ++coverageRequest.current; setCoverageRetrying(true); setCoverageError('');
    try { const response = await apiClient.get('/validation/coverage'); if (request === coverageRequest.current) setCoverage(response.data.data || []); }
    catch (err) { if (request === coverageRequest.current) { setCoverage(null); setCoverageError(getApiErrorMessage(err, 'Coverage data could not be loaded.')); } }
    finally { if (request === coverageRequest.current) setCoverageRetrying(false); }
  };
  useEffect(() => () => { coverageRequest.current += 1; }, []);

  const fetchRuns = useCallback(async () => {
    const request = ++listRequestId.current;
    const coverageRead = ++coverageRequest.current;
    setCoverageRetrying(false); setLoading(true);
    const [runsResult, coverageResult] = await Promise.allSettled([
      apiClient.get('/validation/runs', { params: { page, size: 20, ...(runStatusFilter ? { status: runStatusFilter } : {}), ...(runQuery ? { query: runQuery } : {}), ...(runMode ? { mode: runMode } : {}), ...(runSort !== 'newest' ? { sort: runSort } : {}) } }),
      apiClient.get('/validation/coverage'),
    ]);
    if (request !== listRequestId.current) return;
    if (runsResult.status === 'fulfilled') {
      const data = runsResult.value.data;
      const count = typeof data.total === 'number' ? data.total : (data.data || []).length;
      const lastPage = Math.max(1, Math.ceil(count / 20));
      if (page > lastPage) { setPage(lastPage); return; }
      setRuns(data.data || []); setTotal(count); setError('');
    }
    else setError(getApiErrorMessage(runsResult.reason, 'Validation runs could not be loaded.'));
    if (coverageRead === coverageRequest.current) {
    if (coverageResult.status === 'fulfilled') { setCoverage(coverageResult.value.data.data || []); setCoverageError(''); }
    else { setCoverage(null); setCoverageError(getApiErrorMessage(coverageResult.reason, 'Coverage data could not be loaded.')); }
    }
    setLoading(false);
  }, [runStatusFilter, page, runQuery, runMode, runSort]);

  const createRun = async () => {
    if (!newRun.name.trim() || newRun.techniques.length === 0) return;
    setCreating(true);
    try {
      await apiClient.post('/validation/runs', {
        name: newRun.name,
        description: newRun.description,
        mode: 'dry_run',
        mitre_techniques: newRun.techniques,
      });
      setShowCreate(false);
      setNewRun({ name: '', description: '', techniques: [] });
      toast('Validation run created', 'success');
      await fetchRuns();
    } catch (err) { toast(getApiErrorMessage(err, 'Failed to create run.'), 'error'); }
    finally { setCreating(false); }
  };

  const executeRun = async (runId: number) => {
    if (executing !== null) return;
    setExecuting(runId);
    try {
      await apiClient.post(`/validation/runs/${runId}/execute`);
      toast('Validation complete', 'success');
      setConfirmRunId(null);
      await fetchRuns();
      await viewRun(runId);
    } catch (err) { toast(getApiErrorMessage(err, 'Execution failed.'), 'error'); }
    finally { setExecuting(null); }
  };

  const exportRun = async (runId: number) => {
    if (exportingRun) return;
    setExportingRun(true);
    try {
      const res = await apiClient.get(`/validation/runs/${runId}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `validation-run-${runId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast(getApiErrorMessage(err, 'The export could not be downloaded.'), 'error'); }
    finally { setExportingRun(false); }
  };

  const deleteRun = async () => {
    if (!deletingRun || deletingBusy) return;
    setDeletingBusy(true);
    try {
      await apiClient.delete(`/validation/runs/${deletingRun.id}`);
      toast('Validation run deleted', 'success');
      if (requestedRunId.current === deletingRun.id) closeDetails();
      setDeletingRun(null);
      await fetchRuns();
    } catch (err) { toast(getApiErrorMessage(err, 'The validation run could not be deleted.'), 'error'); }
    finally { setDeletingBusy(false); }
  };

  const closeDetails = () => {
    detailRequestId.current += 1;
    requestedRunId.current = null;
    setDetailRunId(null); setSelectedRun(null); setDetailError(''); setDetailLoading(false);
  };

  const viewRun = async (runId: number) => {
    setShowComparison(false);
    const request = ++detailRequestId.current;
    requestedRunId.current = runId;
    setDetailRunId(runId); setSelectedRun(null); setDetailError(''); setDetailLoading(true);
    setResultFilter('all'); setEvidenceSearch(''); setEvidencePage(1);
    try {
      const res = await apiClient.get(`/validation/runs/${runId}`);
      if (request !== detailRequestId.current) return;
      if (res.data.data?.id !== runId) throw new Error('The response did not match this validation run. Try again.');
      setSelectedRun(res.data.data);
    } catch (err) {
      if (request === detailRequestId.current) setDetailError(getApiErrorMessage(err, 'Run details could not be loaded.'));
    } finally {
      if (request === detailRequestId.current) setDetailLoading(false);
    }
  };

  useEffect(() => () => { detailRequestId.current += 1; }, []);

  const toggleTechnique = (techId: string) => {
    setNewRun(prev => ({
      ...prev,
      techniques: prev.techniques.includes(techId)
        ? prev.techniques.filter(t => t !== techId)
        : [...prev.techniques, techId],
    }));
  };

  useEffect(() => { void fetchRuns(); return () => { listRequestId.current += 1; }; }, [fetchRuns]);

  const evidenceQuery = evidenceSearch.trim().toLowerCase();
  const matchingSteps = (selectedRun?.steps ?? []).filter(step => {
    if (resultFilter !== 'all' && (resultFilter === 'detected' ? step.actual_result !== 'detected' : step.actual_result === 'detected')) return false;
    const searchableValues = [
      step.technique_id, step.technique_name, step.test_name, step.actual_result, step.status, step.test_type,
      ...(step.controls ?? []).flatMap(control => [control.control_name, control.control_type, control.details]),
    ];
    return !evidenceQuery || searchableValues.some(value => value?.toLowerCase().includes(evidenceQuery));
  });
  const evidencePages = Math.max(1, Math.ceil(matchingSteps.length / 10));
  const currentEvidencePage = Math.min(evidencePage, evidencePages);
  const shownSteps = matchingSteps.slice((currentEvidencePage - 1) * 10, currentEvidencePage * 10);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Act" title="Purple-Team Validation" description="Test detection controls against simulated ATT&CK techniques and expose measurable coverage gaps." actions={
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-400 text-surface-950 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Validation
        </button>
      } />

      {/* Create Form */}
      {showCreate && (
        <div className="oa-panel p-6">
          <h2 className="text-lg font-semibold text-surface-50 mb-4">Create Validation Run</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="validation-name" className="block text-sm font-medium text-surface-300 mb-1">Name</label>
              <input id="validation-name" type="text" value={newRun.name} onChange={e => setNewRun({ ...newRun, name: e.target.value })}
                placeholder="e.g. Weekly Detection Coverage Test"
                className="w-full px-4 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">ATT&CK Techniques</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {AVAILABLE_TECHNIQUES.map(t => (
                  <button key={t.id} aria-pressed={newRun.techniques.includes(t.id)} onClick={() => toggleTechnique(t.id)}
                    className={clsx('p-2 rounded-lg text-left text-xs border transition-colors',
                      newRun.techniques.includes(t.id)
                        ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                        : 'border-surface-700 bg-surface-900/50 text-surface-400 hover:border-surface-600')}>
                    <span className="font-mono font-medium">{t.id}</span>
                    <p className="text-xs mt-0.5 truncate">{t.name}</p>
                  </button>
                ))}
              </div>
            </div>
            <button onClick={createRun} disabled={creating || !newRun.name.trim() || newRun.techniques.length === 0}
              className="px-6 py-2 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-surface-950 rounded-lg text-sm font-medium transition-colors">
              {creating ? 'Creating...' : 'Create Run'}
            </button>
          </div>
        </div>
      )}

      {/* Coverage by technique */}
      {!loading && coverageRetrying && <p role="status" className="text-sm text-surface-400">Retrying validation coverage...</p>}
      {!loading && coverageError && (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3"><p role="alert" className="text-sm text-warning">{coverageError}</p><button type="button" onClick={() => void retryCoverage()} className="rounded border border-surface-600 px-3 py-1.5 text-xs text-primary-300">Retry validation coverage</button></div>
      )}
      {!loading && !coverageError && coverage && coverage.length > 0 && (
        <div className="oa-panel p-6">
          <h2 className="text-lg font-semibold text-surface-50 mb-4">Detection Coverage by Technique</h2>
          <p className="mb-4 text-xs text-surface-400">Recorded control-result aggregates across runs, including simulations. This summary does not establish verified live detection coverage. Review the evidence below to separate execution flags and missing outcomes.</p>
          <ul className="space-y-2">
            {coverage.map(c => (
              <li key={JSON.stringify([c.technique_id, c.technique_name])} className="flex items-center gap-4 rounded-lg border border-surface-800 bg-surface-900/30 p-3">
                <span className="font-mono text-xs text-primary-400 w-16 shrink-0">{c.technique_id}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-surface-300">{c.technique_name}</span>
                <span className="text-xs text-surface-500 shrink-0">{c.detections}/{c.total_tests} detected</span>
                <span className={clsx('w-12 text-right text-sm font-bold shrink-0', coverageTone(c.detection_rate))}>
                  {c.detection_rate}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && <ValidationCoverageEvidence />}

      {/* Runs List */}
      <div className="oa-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-surface-50">Validation Runs</h2>
          <label className="flex items-center gap-2 text-xs text-surface-400">
            Status
            <select
              aria-label="Filter runs by status"
              value={runStatusFilter}
              onChange={(e) => { setRunStatusFilter(e.target.value); setPage(1); }}
              className="rounded-md border border-surface-600 bg-surface-950 px-2 py-1.5 text-sm text-surface-100"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <form aria-label="Search validation run history" className="mb-3 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setRunQuery(runSearchDraft.trim()); setPage(1); }}>
          <label className="min-w-[12rem] flex-1 text-xs text-surface-300">Run ID, name or description<input aria-label="Search validation runs" maxLength={200} value={runSearchDraft} onChange={event => setRunSearchDraft(event.target.value)} className="mt-1 block w-full rounded border border-surface-600 bg-surface-950 p-2 text-sm text-surface-100" /></label>
          <button type="submit" className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Search run history</button>
          <label className="text-xs text-surface-300">Saved mode<select aria-label="Filter validation runs by mode" value={runMode} onChange={event => { setRunMode(event.target.value); setPage(1); }} className="mt-1 block rounded border border-surface-600 bg-surface-950 p-2 text-sm"><option value="">All modes</option><option value="dry_run">Dry run</option><option value="lab">Lab</option><option value="production">Production records</option></select></label>
          <label className="text-xs text-surface-300">Order<select aria-label="Order validation run history" value={runSort} onChange={event => { setRunSort(event.target.value); setPage(1); }} className="mt-1 block rounded border border-surface-600 bg-surface-950 p-2 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
          <button type="button" onClick={() => { setRunSearchDraft(''); setRunQuery(''); setRunMode(''); setRunSort('newest'); setRunStatusFilter(''); setPage(1); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-300">Clear run history filters</button>
        </form>
        {runSearchDraft.trim() !== runQuery && <p className="mb-3 text-xs text-warning">Run history search draft not applied. Current keyword: {runQuery || 'any'}.</p>}
        <p className="mb-3 text-xs text-surface-400">History filters search all your saved runs, not just this page. Search is literal and case-insensitive across run IDs, names and descriptions, not step results or control details. Coverage summaries above remain across all runs. Filtering saved modes does not enable production execution, run a test or prove live detection. Open results to review the recorded evidence.</p>
        {loading ? <LoadingSurface label="Loading validation runs" /> : error ? <ErrorState title="Validation unavailable" description={error} action={<RetryButton onClick={fetchRuns} />} /> : runs.length === 0 ? (
          <EmptyState title="No validation runs" description="No saved run matches the applied filters. Clear filters to review all runs." />
        ) : (
          <div className="space-y-3">
            {runs.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-700 bg-surface-900/50 p-4 sm:flex-nowrap">
                <ShieldCheck className="w-5 h-5 text-primary-400 shrink-0" />
                <div className="min-w-0 flex-1 basis-40">
                  <button type="button" onClick={() => void viewRun(r.id)} aria-label={`View results for ${r.name}`}
                    className="rounded text-left text-sm font-semibold text-surface-50 hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{r.name}</button>
                  <p className="text-xs text-surface-500">
                    Run #{r.id} · {r.mitre_techniques?.length || 0} techniques · {r.mode} · {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                {r.results_summary && (
                  <div className="text-right">
                    <p className={clsx('text-lg font-bold', r.results_summary.detection_rate >= 70 ? 'text-success' : r.results_summary.detection_rate >= 40 ? 'text-warning' : 'text-danger')}>
                      {r.results_summary.detection_rate}%
                    </p>
                    <p className="text-xs text-surface-500">{r.results_summary.detected}/{r.results_summary.tested} detected</p>
                  </div>
                )}
                <span className={clsx('text-xs px-2 py-0.5 rounded', STATUS_STYLES[r.status] || STATUS_STYLES.pending)}>
                  {r.status}
                </span>
                {r.status === 'pending' && (
                  <button disabled={executing !== null} onClick={e => { e.stopPropagation(); setConfirmRunId(r.id); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 text-surface-950 rounded text-xs font-medium transition-colors">
                    <Play className="w-3 h-3" /> Run
                  </button>
                )}
                <button type="button" aria-label={`Delete validation run ${r.name}`} onClick={e => { e.stopPropagation(); setDeletingRun(r); }}
                  className="flex items-center gap-1 rounded border border-surface-600 px-2.5 py-1.5 text-xs text-surface-300 transition-colors hover:bg-surface-800">
                  <Trash2 className="w-3 h-3" aria-hidden="true" /> Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && !error && total > 0 && <nav aria-label="Validation run pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p role="status" className="text-surface-400">Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total} matching runs · Page {page} of {Math.ceil(total / 20)}</p>
        <div className="flex gap-2">
          <button type="button" disabled={page === 1 || executing !== null || deletingBusy} onClick={() => setPage(value => value - 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Previous runs</button>
          <button type="button" disabled={page * 20 >= total || executing !== null || deletingBusy} onClick={() => setPage(value => value + 1)} className="rounded-md border border-surface-600 px-3 py-2 text-surface-200 disabled:opacity-40">Next runs</button>
        </div>
      </nav>}

      {/* Run Detail */}
      {detailRunId !== null && <section aria-label={`Validation run ${detailRunId} detail status`} className="oa-panel space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold text-surface-200">Selected validation run #{detailRunId}</h2><button type="button" onClick={closeDetails} className="rounded-md border border-surface-600 px-3 py-1.5 text-sm text-surface-200">Close results</button></div>
        {detailLoading && <p role="status" className="text-sm text-surface-400">Loading selected run results...</p>}
        {detailError && <><p role="alert" className="text-sm text-danger">{detailError}</p><button type="button" onClick={() => void viewRun(detailRunId)} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200">Retry run details</button></>}
      </section>}
      {selectedRun && (
        <div className="oa-panel p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-surface-50 flex items-center gap-2">
              <Target className="w-5 h-5 text-primary-400" />
              {selectedRun.name} - Results
            </h2>
            <button type="button" onClick={() => setShowComparison(value => !value)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Compare recorded outcomes</button>
            <button type="button" onClick={() => void exportRun(selectedRun.id)} disabled={exportingRun}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs text-surface-200 hover:bg-surface-800 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {exportingRun ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>

          {showComparison && <ValidationComparison key={selectedRun.id} current={selectedRun} onClose={() => setShowComparison(false)} />}
          {selectedRun.description && <p className="mb-4 text-sm text-surface-400">{selectedRun.description}</p>}
          {selectedRun.mode === 'dry_run' && (
            <div className="mb-5 rounded-md border border-info/30 bg-info/10 p-3 text-sm text-info" role="note">
              Dry-run simulation. These results do not prove that live detection controls fired.
            </div>
          )}

          {selectedRun.results_summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-surface-50">{selectedRun.results_summary.tested}</p>
                <p className="text-xs text-surface-500">Tests Run</p>
              </div>
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-success">{selectedRun.results_summary.detected}</p>
                <p className="text-xs text-surface-500">Detected</p>
              </div>
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-danger">{selectedRun.results_summary.missed}</p>
                <p className="text-xs text-surface-500">Missed</p>
              </div>
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className={clsx('text-2xl font-bold', selectedRun.results_summary.detection_rate >= 70 ? 'text-success' : 'text-warning')}>
                  {selectedRun.results_summary.detection_rate}%
                </p>
                <p className="text-xs text-surface-500">Detection Rate</p>
              </div>
            </div>
          )}

          {selectedRun.steps?.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter validation results">
                {([
                  { key: 'all', label: 'All results', count: selectedRun.steps.length },
                  { key: 'attention', label: 'Needs attention', count: selectedRun.steps.filter(step => step.actual_result !== 'detected').length },
                  { key: 'detected', label: 'Detected', count: selectedRun.steps.filter(step => step.actual_result === 'detected').length },
                ] as const).map(filter => (
                  <button key={filter.key} type="button" aria-pressed={resultFilter === filter.key} onClick={() => { setResultFilter(filter.key); setEvidencePage(1); }}
                    className={clsx('rounded-md border px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      resultFilter === filter.key ? 'border-primary-500 bg-primary-500/10 text-primary-300' : 'border-surface-700 text-surface-400 hover:bg-surface-800')}>
                    {filter.label} ({filter.count})
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <input aria-label="Search recorded validation evidence" value={evidenceSearch}
                  onChange={event => { setEvidenceSearch(event.target.value); setEvidencePage(1); }}
                  placeholder="Technique, test or control evidence"
                  className="min-w-0 basis-full rounded border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-100 sm:flex-1 sm:basis-auto" />
                <button type="button" disabled={!matchingSteps.length} onClick={() => {
                  const csv = validationEvidenceCsv(selectedRun, matchingSteps, resultFilter, evidenceSearch);
                  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `validation-${selectedRun.id}-filtered-evidence.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">
                  Export filtered evidence
                </button>
              </div>
              <p className="text-xs text-surface-400">
                {matchingSteps.length} of {selectedRun.steps.length} loaded steps match. CSV includes all matching loaded steps and their saved controls, not just this page. No validation is executed.
              </p>
              <nav aria-label="Recorded evidence pages" className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-surface-400">Evidence page {currentEvidencePage} of {evidencePages}</span>
                <div className="flex gap-2">
                  <button type="button" disabled={currentEvidencePage === 1} onClick={() => setEvidencePage(currentEvidencePage - 1)}
                    className="rounded border border-surface-600 px-3 py-1.5 text-xs text-surface-200 disabled:opacity-40">Previous evidence</button>
                  <button type="button" disabled={currentEvidencePage === evidencePages} onClick={() => setEvidencePage(currentEvidencePage + 1)}
                    className="rounded border border-surface-600 px-3 py-1.5 text-xs text-surface-200 disabled:opacity-40">More evidence</button>
                </div>
              </nav>
              {shownSteps.map(step => (
                <div key={step.id} className="min-w-0 rounded-lg border border-surface-800 bg-surface-900/30 p-3">
                <div className="flex flex-wrap items-start gap-3 sm:items-center">
                  {step.actual_result === 'detected' ? <CheckCircle className="h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : <XCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
                  <span className="font-mono text-xs text-primary-400">{step.technique_id}</span>
                  <span className="min-w-0 flex-1 basis-40 break-words text-sm text-surface-300">{step.test_name}</span>
                  <StatusBadge tone={step.actual_result === 'detected' ? 'success' : step.actual_result === 'missed' || step.actual_result === 'error' ? 'danger' : 'warning'}>{step.actual_result || 'Not run'}</StatusBadge>
                  <span className="text-xs tabular-nums text-surface-500">{step.duration_ms === null ? 'Not timed' : `${step.duration_ms}ms`}</span>
                </div>
                  <details className="mt-3 border-t border-surface-700 pt-3 text-sm">
                    <summary aria-label={`Inspect recorded evidence for ${step.technique_id}: ${step.test_name}`} className="cursor-pointer text-primary-400">Inspect recorded evidence</summary>
                    <p className="mt-3 text-xs text-surface-400">Saved validation records, not a fresh control check. Simulated results do not prove live detections. Missing records do not establish that no detection occurred.</p>
                    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-surface-400">Execution kind</dt><dd className="text-surface-200">{step.simulated === true ? 'Simulated' : step.simulated === false ? 'Recorded as non-simulated' : 'Not recorded'}</dd></div>
                      <div><dt className="text-xs text-surface-400">Recorded step status</dt><dd className="break-words text-surface-200">{step.status || 'Not recorded'}</dd></div>
                      <div><dt className="text-xs text-surface-400">Test type</dt><dd className="break-words text-surface-200">{step.test_type || 'Not recorded'}</dd></div>
                      <div><dt className="text-xs text-surface-400">Executed at</dt><dd className="break-words text-surface-200">{step.executed_at ? (Number.isNaN(Date.parse(step.executed_at)) ? step.executed_at : new Date(step.executed_at).toLocaleString()) : 'Not recorded'}</dd></div>
                    </dl>
                    <h3 className="mt-4 font-semibold text-surface-200">Recorded control results ({step.controls?.length || 0})</h3>
                    {!step.controls?.length ? <p className="mt-2 text-surface-400">No control results recorded for this step.</p> : <ul className="mt-3 space-y-3">
                      {step.controls.map(control => <li key={control.id} className="min-w-0 space-y-2 rounded-md border border-surface-700 p-3">
                        <h4 className="break-words font-semibold text-surface-100">{control.control_name}</h4>
                        <p className="break-words text-xs text-surface-400">Type: {control.control_type}</p>
                        <p className="text-surface-300">Expected to detect: {control.expected ? 'Yes' : 'No'} · Recorded detection: {control.detected ? 'Yes' : 'No'}</p>
                        <p className="text-xs text-surface-400">Recorded detection time: {control.detection_time_ms === null ? 'Not recorded' : `${control.detection_time_ms} ms`}</p>
                        <p className="whitespace-pre-wrap break-words text-surface-300">{control.details || 'No control detail recorded.'}</p>
                      </li>)}
                    </ul>}
                  </details>
                </div>
              ))}
              {matchingSteps.length === 0 && (
                <p className="rounded-md border border-surface-800 p-4 text-sm text-surface-400" role="status">No results match this filter.</p>
              )}
            </div>
          )}
        </div>
      )}
      {confirmRunId !== null && (
        <ConfirmDialog
          title={`Run validation #${confirmRunId}?`}
          description="The run simulates its ATT&CK techniques against your detection controls and records per-step results."
          confirmLabel="Run now"
          busy={executing !== null}
          onCancel={() => setConfirmRunId(null)}
          onConfirm={() => void executeRun(confirmRunId)}
        />
      )}
      {deletingRun && (
        <ConfirmDialog
          title="Delete validation run"
          description={`Delete "${deletingRun.name}"? Its steps and recorded results are removed permanently.`}
          confirmLabel="Delete run"
          tone="danger"
          busy={deletingBusy}
          onCancel={() => setDeletingRun(null)}
          onConfirm={() => void deleteRun()}
        />
      )}
    </div>
  );
}
