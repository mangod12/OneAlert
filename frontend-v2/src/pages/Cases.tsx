import { CaseListCloseReview } from '../components/CaseListCloseReview';
import { RecordedRunLinks } from '../components/RecordedRunLinks';
import { TriageCorrelationPreview } from '../components/TriageCorrelationPreview';
import { DetectionCoveragePreview } from '../components/DetectionCoveragePreview';
import { TriageIntakePreview } from '../components/TriageIntakePreview';
import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { Play, Plus, Search, Shield, ChevronRight, X } from 'lucide-react';
import { getApiErrorMessage, getDownloadErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useDialogFocus } from '../components/ui/useDialogFocus';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { alertSeverityTones, caseStatusTones } from '../components/ui/tones';
import { toast } from '../components/Toast';
import { SavedViewsMenu } from '../components/SavedViewsMenu';

interface CaseViewFilters {
  search?: string;
  severity?: string;
  status?: string;
  assigned?: string;
  overdue?: boolean;
  sort?: string;
}

interface CaseItem {
  id: number;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  confidence_score: number | null;
  mitre_tactics: string[] | null;
  created_by: string;
  created_at: string;
  alert_count: number;
  event_count: number;
  assigned_to_id: number | null;
  assigned_to_email: string | null;
  due_date: string | null;
}

interface CaseSearchResult {
  case_id: number;
  title: string;
  score: number;
  snippet: string;
}

interface PipelineStageResult {
  status?: string;
  summary?: string;
  error?: string;
}

interface PipelineResult {
  run_ids?: { detect?: number | null; triage?: number | null };
  hours_back?: number;
  detect: PipelineStageResult | null;
  triage: PipelineStageResult | null;
  total_duration_ms: number;
  pipeline_status: string;
}

const CASE_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const;

export function Cases() {
  const [closeReview, setCloseReview] = useState<{ ids: number[]; target: string } | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [triaging, setTriaging] = useState(false);
  const [triageResult, setTriageResult] = useState<{ status: string; summary: string; run_id?: number } | null>(null);
  const [intakeVersion, setIntakeVersion] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CaseSearchResult[] | null>(null);
  const listRequest = useRef(0);
  const searchRequest = useRef(0);
  const [searchError, setSearchError] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [pipelining, setPipelining] = useState(false);
  const [pipelineLookback, setPipelineLookback] = useState(24);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [showNewCase, setShowNewCase] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [today, setToday] = useState('');
  const [sort, setSort] = useState('created_at_desc');
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [members, setMembers] = useState<Array<{ id: number; email: string; is_active: boolean }>>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const viewKey = JSON.stringify([keyword, statusFilter, severityFilter, assignedFilter, overdueOnly, sort, page]);
  const liveViewKey = useRef(viewKey);
  useLayoutEffect(() => { liveViewKey.current = viewKey; }, [viewKey]);
  const fetchCases = useCallback(async () => {
    const key = viewKey;
    if (key !== liveViewKey.current) return;
    const request = ++listRequest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/cases/', {
        params: {
          page,
          size: 20,
          ...(keyword ? { search: keyword } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(severityFilter ? { severity: severityFilter } : {}),
          ...(assignedFilter === 'watching' ? { watching: 'me' } : assignedFilter ? { assigned: assignedFilter } : {}),
          ...(overdueOnly ? { overdue: true } : {}),
          sort,
        },
      });
      if (request !== listRequest.current || key !== liveViewKey.current) return;
      setCases(res.data.cases);
      setTotal(res.data.total);
    } catch (err: unknown) {
      if (request !== listRequest.current || key !== liveViewKey.current) return;
      setCases([]);
      setTotal(0);
      setError(getApiErrorMessage(err, 'Investigations could not be loaded.'));
    } finally {
      if (request === listRequest.current && key === liveViewKey.current) setLoading(false);
    }
  }, [keyword, viewKey, page, statusFilter, severityFilter, assignedFilter, overdueOnly, sort]);

  const handleCreateCase = async (title: string, summary: string, severity: string) => {
    if (creatingCase) return;
    setCreatingCase(true);
    try {
      await apiClient.post('/cases/', { title, summary: summary || null, severity });
      setShowNewCase(false);
      toast('Investigation opened.', 'success');
      await fetchCases();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The investigation could not be opened.'), 'error');
    } finally {
      setCreatingCase(false);
    }
  };

  const runPipeline = async () => {
    setPipelining(true);
    setPipelineResult(null);
    try {
      const res = await apiClient.post('/cases/pipeline', null, { params: { hours_back: pipelineLookback } });
      setPipelineResult((res.data?.data ?? res.data) as PipelineResult);
      setIntakeVersion(version => version + 1);
      await fetchCases();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The detection pipeline could not be run.'), 'error');
    } finally {
      setPipelining(false);
    }
  };

  const runTriage = async () => {
    setTriaging(true);
    setTriageResult(null);
    try {
      const response = await apiClient.post('/cases/auto-triage', null, { params: { hours_back: 72 } });
      const result = response.data?.data;
      if (result && typeof result.summary === 'string') setTriageResult({ status: typeof result.status === 'string' ? result.status : 'unknown', summary: result.summary, run_id: result.run_id });
      setIntakeVersion(version => version + 1);
      await fetchCases();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'AI triage could not be started.'), 'error');
    } finally {
      setTriaging(false);
    }
  };

  useEffect(() => { void fetchCases(); return () => { listRequest.current += 1; }; }, [fetchCases]);

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  useEffect(() => {
    apiClient.get<Array<{ id: number; email: string; is_active: boolean }>>('/orgs/me/members')
      .then(res => { if (Array.isArray(res.data)) setMembers(res.data.filter(m => m.is_active)); })
      .catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
    setPendingIds(new Set());
  }, [keyword, statusFilter, severityFilter, assignedFilter, overdueOnly, sort, page]);

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params: Record<string, string | number | boolean> = { sort };
      if (keyword) params.search = keyword;
      if (statusFilter) params.status = statusFilter;
      if (severityFilter) params.severity = severityFilter;
      if (assignedFilter === 'watching') params.watching = 'me';
      else if (assignedFilter) params.assigned = assignedFilter;
      if (overdueOnly) params.overdue = true;
      const res = await apiClient.get('/cases/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cases.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast(await getDownloadErrorMessage(err, 'The export could not be downloaded.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const isOverdue = (c: CaseItem) =>
    !!c.due_date && !!today && c.due_date < today && !['resolved', 'closed', 'false_positive'].includes(c.status);

  const changeCaseStatus = async (c: CaseItem, status: string) => {
    if (updatingStatusId !== null || status === c.status) return;
    if (['resolved', 'closed', 'false_positive'].includes(status)) { setCloseReview({ ids: [c.id], target: status }); return; }
    setUpdatingStatusId(c.id);
    try {
      await apiClient.patch(`/cases/${c.id}`, null, { params: { status_update: status } });
      setCases(prev => prev.map(x => (x.id === c.id ? { ...x, status } : x)));
      toast(`Case #${c.id} marked ${status}.`, 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The case status could not be updated.'), 'error');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const visibleSelected = () => Array.from(selectedIds).filter(id => !pendingIds.has(id));

  const finishBulk = async (ids: number[], results: PromiseSettledResult<unknown>[], okMessage: string, failMessage: string) => {
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failedIds));
    setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
    await fetchCases();
    if (failedIds.length > 0) toast(`${failedIds.length} ${failMessage}`, 'error');
    else toast(okMessage, 'success');
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = cases.length > 0 && cases.every(c => selectedIds.has(c.id));

  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(cases.map(c => c.id)));
  };

  const handleBulkAssign = async (value: string) => {
    if (value === '' || bulkBusy) return;
    const assigneeId = value === 'none' ? null : Number(value);
    const member = members.find(m => m.id === assigneeId) ?? null;
    const ids = visibleSelected();
    if (ids.length === 0) return;
    setBulkBusy(true);
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id => apiClient.post(`/cases/${id}/assign`, { user_id: assigneeId })));
    setBulkBusy(false);
    const target = member ? member.email : 'Unassigned';
    await finishBulk(ids, results,
      assigneeId === null ? `${ids.length} investigations unassigned.` : `${ids.length} investigations assigned to ${target}.`,
      'investigations could not be assigned and remain selected.');
  };

  const handleBulkStatus = async (status: string) => {
    if (status === '' || bulkBusy) return;
    const ids = visibleSelected();
    if (ids.length === 0) return;
    if (['resolved', 'closed', 'false_positive'].includes(status)) {
      setCloseReview({ ids, target: status }); return;
    }
    setBulkBusy(true);
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id => apiClient.patch(`/cases/${id}`, null, { params: { status_update: status } })));
    setBulkBusy(false);
    await finishBulk(ids, results,
      `${ids.length} investigations marked ${status}.`,
      'investigations could not be updated and remain selected.');
  };

  const handleBulkDelete = async () => {
    if (bulkBusy) return;
    const ids = visibleSelected();
    if (ids.length === 0) return;
    setConfirmBulkDelete(false);
    setBulkBusy(true);
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id => apiClient.delete(`/cases/${id}`)));
    setBulkBusy(false);
    await finishBulk(ids, results,
      `${ids.length} investigations deleted.`,
      'investigations could not be deleted and remain selected.');
  };

  const handleBulkWatch = async (watch: boolean) => {
    if (bulkBusy) return;
    const ids = visibleSelected();
    if (ids.length === 0) return;
    setBulkBusy(true);
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id =>
      watch ? apiClient.post(`/cases/${id}/watch`) : apiClient.delete(`/cases/${id}/watch`)
    ));
    setBulkBusy(false);
    const verb = watch ? 'watched' : 'unwatched';
    await finishBulk(ids, results,
      `${ids.length} investigations ${verb}.`,
      `investigations could not be ${verb} and remain selected.`);
  };

  const runSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2 || searching) {
      if (q.length > 0 && q.length < 2) toast('Type at least 2 characters to search.', 'info');
      return;
    }
    const request = ++searchRequest.current;
    setSearching(true);
    setSearchResults(null);
    setSearchError('');
    setSearchedQuery(q);
    try {
      const res = await apiClient.get('/cases/search', { params: { q } });
      if (request === searchRequest.current) setSearchResults(res.data.data ?? []);
    } catch (err: unknown) {
      if (request === searchRequest.current) setSearchError(getApiErrorMessage(err, 'The search could not be completed.'));
    } finally {
      if (request === searchRequest.current) setSearching(false);
    }
  };

  const clearSearch = () => {
    searchRequest.current += 1;
    setSearching(false);
    setSearchError('');
    setSearchedQuery('');
    setSearchQuery('');
    setSearchResults(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Command" title="Investigations" description={loading ? 'Loading the current investigation view.' : error ? 'Current investigation totals are unavailable.' : `${total} cases correlated from alerts, security events, and agent analysis.`} actions={
        <>
          <button
            onClick={() => setShowNewCase(true)}
            className="flex min-h-9 items-center gap-2 rounded-md border border-surface-600 px-3.5 text-sm font-semibold text-surface-200 hover:bg-surface-800"
          >
            <Plus className="w-4 h-4" />
            New investigation
          </button>
          <label htmlFor="pipeline-lookback" className="sr-only">Pipeline lookback</label>
          <select
            id="pipeline-lookback"
            value={pipelineLookback}
            onChange={e => setPipelineLookback(Number(e.target.value))}
            className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"
          >
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 72 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
          <button
            onClick={runPipeline}
            disabled={pipelining || triaging}
            className="flex min-h-9 items-center gap-2 rounded-md border border-primary-500/40 px-3.5 text-sm font-semibold text-primary-300 hover:bg-primary-500/10 disabled:opacity-50"
          >
            <Shield className="w-4 h-4" />
            {pipelining ? 'Running pipeline…' : 'Run pipeline'}
          </button>
          <button
            onClick={runTriage}
            disabled={triaging || pipelining}
            className="flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {triaging ? 'Running triage…' : 'Run AI triage'}
          </button>
        </>
      } />

      <DetectionCoveragePreview key={`detection-${intakeVersion}`} />
      <TriageIntakePreview key={intakeVersion} />
      <TriageCorrelationPreview key={`correlation-${intakeVersion}`} />

      {triageResult && <section aria-label="Automatic triage result" className="oa-panel space-y-2 p-4"><h2 className="text-sm font-semibold text-surface-100">Automatic triage outcome: {triageResult.status}</h2><p className="text-sm text-surface-300">{triageResult.summary}</p><RecordedRunLinks runs={[{ label: 'Triage', id: triageResult.run_id }]} />{triageResult.status !== 'completed' && <p className="text-xs text-warning">This run did not establish complete triage. Review the agent run evidence before retrying; do not assume zero created cases means no incident.</p>}<button type="button" className="text-xs text-primary-300" onClick={() => setTriageResult(null)}>Dismiss triage result</button></section>}

      {pipelineResult && (
        <div role="status" className="rounded-md border border-surface-700 bg-surface-900/60 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-surface-100">Pipeline outcome: {pipelineResult.pipeline_status} · {(pipelineResult.total_duration_ms / 1000).toFixed(1)}s</p>
              {pipelineResult.pipeline_status !== 'completed' && <p className="text-warning">At least one stage did not complete successfully. Review the stage results; this is not an all-clear.</p>}
              <RecordedRunLinks runs={[{ label: 'Detect', id: pipelineResult.run_ids?.detect }, { label: 'Triage', id: pipelineResult.run_ids?.triage }]} />
              <p className="text-xs text-surface-400">Detection findings are returned as review leads. New runs also save bounded finding summaries in the exact Detect run receipt; earlier runs may not have them. They are not automatically saved as alerts or passed to triage. Triage separately reads eligible saved alerts and events, with its own batch and AI-input limits. These stages are sequential reads, not one frozen evidence snapshot.</p>
              <p className="text-surface-300">Detect: {pipelineResult.detect?.summary ?? pipelineResult.detect?.error ?? 'No detect stage result.'}</p>
              <p className="text-surface-300">Triage: {pipelineResult.triage?.summary ?? pipelineResult.triage?.error ?? 'No triage stage result.'}</p>
            </div>
            <button type="button" onClick={() => setPipelineResult(null)} aria-label="Dismiss pipeline result" className="text-surface-400 hover:text-surface-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {(
        <div className="flex flex-wrap items-center gap-2">
          <SavedViewsMenu<CaseViewFilters>
            basePath="/cases/views/"
            currentFilters={{
              ...(keyword ? { search: keyword } : {}),
              ...(statusFilter ? { status: statusFilter } : {}),
              ...(severityFilter ? { severity: severityFilter } : {}),
              ...(assignedFilter ? { assigned: assignedFilter } : {}),
              ...(overdueOnly ? { overdue: true } : {}),
              sort,
            }}
            onApply={(filters: CaseViewFilters) => {
              setKeyword(filters.search ?? '');
              setKeywordDraft(filters.search ?? '');
              setStatusFilter(filters.status ?? '');
              setSeverityFilter(filters.severity ?? '');
              setAssignedFilter(filters.assigned ?? '');
              setOverdueOnly(filters.overdue ?? false);
              setSort(filters.sort ?? 'created_at_desc');
              setPage(1);
            }}
          />
          <label htmlFor="case-status-filter" className="sr-only">Filter by status</label>
          <select id="case-status-filter" value={statusFilter} onChange={e => { setPage(1); setStatusFilter(e.target.value); }} className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="false_positive">False positive</option>
          </select>
          <label htmlFor="case-severity-filter" className="sr-only">Filter by severity</label>
          <select id="case-severity-filter" value={severityFilter} onChange={e => { setPage(1); setSeverityFilter(e.target.value); }} className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200">
            <option value="">All severities</option>
            <option value="info">Info</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <label htmlFor="case-assigned-filter" className="sr-only">Filter by assignee</label>
          <select id="case-assigned-filter" value={assignedFilter} onChange={e => { setPage(1); setAssignedFilter(e.target.value); }} className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="watching">Watched by me</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <button type="button" onClick={() => { setPage(1); setOverdueOnly(v => !v); }} aria-pressed={overdueOnly}
            className={`min-h-9 rounded-md border px-3 text-sm transition-colors ${overdueOnly ? 'border-red-500/50 bg-red-500/10 text-red-300' : 'border-surface-600 bg-surface-950 text-surface-400 hover:text-surface-200'}`}>
            Overdue
          </button>
          <label htmlFor="case-sort" className="sr-only">Sort investigations</label>
          <select id="case-sort" value={sort} onChange={e => { setPage(1); setSort(e.target.value); }} className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200">
            <option value="created_at_desc">Newest first</option>
            <option value="created_at_asc">Oldest first</option>
            <option value="severity_desc">Highest severity</option>
            <option value="severity_asc">Lowest severity</option>
            <option value="due_date_asc">Due date (earliest)</option>
            <option value="due_date_desc">Due date (latest)</option>
          </select>
          <button type="button" onClick={() => void exportCsv()} disabled={exporting || loading || !!error}
            className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-3 text-sm text-surface-300 hover:text-surface-100 disabled:opacity-40">
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      )}

      <form aria-label="Filter investigations by keyword" className="space-y-2 rounded border border-surface-700 p-3" onSubmit={event => { event.preventDefault(); setKeyword(keywordDraft.trim()); setPage(1); }}>
        <label htmlFor="case-keyword" className="block text-xs text-surface-300">Filter all accessible investigations by keyword</label>
        <div className="flex flex-wrap gap-2"><input id="case-keyword" type="search" maxLength={200} value={keywordDraft} onChange={event => setKeywordDraft(event.target.value)} placeholder="Title, summary or record ID" className="min-h-10 w-full min-w-0 rounded border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100 sm:w-auto sm:flex-1" /><button type="submit" className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Apply keyword filter</button>{(keyword || keywordDraft) && <button type="button" onClick={() => { setKeyword(''); setKeywordDraft(''); setPage(1); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Clear keyword filter</button>}</div>
        <p className="text-xs text-surface-400">{keyword ? `Applied keyword: ${keyword}. ` : 'No keyword filter applied. '}Literal, case-insensitive matching across the accessible investigation list. Combines with list filters, page totals, saved views and CSV export. Plain-language search below is separate.</p>
      </form>

      {!error && (
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void runSearch(); }}>
          <label htmlFor="case-search" className="sr-only">Search investigations</label>
          <input
            id="case-search"
            type="text"
            autoComplete="off"
            value={searchQuery}
            onChange={e => { searchRequest.current += 1; setSearching(false); setSearchResults(null); setSearchError(''); setSearchQuery(e.target.value); }}
            placeholder="Search investigations in plain language…"
            className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
          />
          <button type="submit" disabled={searching} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">
            <Search className="h-4 w-4" /> {searching ? 'Searching…' : 'Search'}
          </button>
          {(searchResults !== null || searchQuery || searchError || searching) && (
            <button type="button" onClick={clearSearch} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">
              <X className="h-4 w-4" /> Clear
            </button>
          )}
        </form>
      )}

      {searching && <p role="status" className="text-sm text-surface-400">Searching recorded investigations...</p>}
      {searchError && <div role="alert" className="space-y-2 rounded border border-danger/40 p-3 text-sm text-danger"><p>{searchError} Search results are unavailable, not empty.</p><button type="button" onClick={() => void runSearch()} className="rounded border border-surface-600 px-3 py-2 text-surface-200">Retry investigation search</button></div>}
      {searchResults !== null && (
        <div className="oa-panel p-5">
          <h2 className="mb-3 text-sm font-semibold text-surface-100">{searchResults.length} result{searchResults.length === 1 ? '' : 's'} for this search</h2><p className="mb-3 break-words text-xs text-surface-400">Query: {searchedQuery}. Plain-language search is separate from the list filters below.</p>
          {searchResults.length === 0 ? (
            <p className="text-sm text-surface-500">No investigations match that search.</p>
          ) : (
            <ul className="divide-y divide-surface-800">
              {searchResults.map(result => (
                <li key={result.case_id}>
                  <Link to={`/cases/${result.case_id}`} className="block py-3 transition hover:bg-surface-800/40">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-surface-100">{result.title}</p>
                      <span className="shrink-0 text-xs text-surface-500">{Math.round(result.score * 100)}% match</span>
                    </div>
                    {result.snippet && <p className="mt-1 line-clamp-2 text-xs text-surface-400">{result.snippet}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <LoadingSurface rows={3} label="Loading investigations" />
      ) : error ? (
        <ErrorState title="Investigations unavailable" description={error} action={<RetryButton onClick={() => void fetchCases()} />} />
      ) : cases.length === 0 ? (
        <EmptyState title="No investigations yet" description="Run AI triage to correlate alerts and security events into investigation cases." action={<button type="button" onClick={() => void runTriage()} className="text-sm font-semibold text-primary-300">Run AI triage</button>} />
      ) : (
        <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-surface-400">
            <input
              type="checkbox"
              aria-label="Select all investigations on this page"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            Select page
          </label>
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-live="polite">
              <span className="text-xs text-surface-400">{selectedIds.size} selected</span>
              {members.length > 0 && (
                <select
                  aria-label="Assign selected investigations"
                  value=""
                  disabled={bulkBusy}
                  onChange={e => { void handleBulkAssign(e.target.value); }}
                  className="min-h-8 rounded-md border border-surface-600 bg-surface-800 px-2 text-xs text-surface-200 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  <option value="" disabled>Assign...</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>{m.email}</option>
                  ))}
                  <option value="none">Unassign</option>
                </select>
              )}
              <select
                aria-label="Set status for selected investigations"
                value=""
                disabled={bulkBusy}
                onChange={e => { void handleBulkStatus(e.target.value); }}
                className="min-h-8 rounded-md border border-surface-600 bg-surface-800 px-2 text-xs text-surface-200 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              >
                <option value="" disabled>Mark...</option>
                {CASE_STATUSES.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkWatch(true)}
                aria-label="Watch selected investigations"
                className="min-h-8 rounded-md border border-surface-600 bg-surface-800 px-2.5 text-xs font-medium text-surface-200 hover:border-primary-500/50 disabled:opacity-50"
              >
                Watch
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkWatch(false)}
                aria-label="Unwatch selected investigations"
                className="min-h-8 rounded-md border border-surface-600 bg-surface-800 px-2.5 text-xs font-medium text-surface-200 hover:border-primary-500/50 disabled:opacity-50"
              >
                Unwatch
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setConfirmBulkDelete(true)}
                className="min-h-8 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
        <div className="grid gap-4">
          {cases.map(c => (
            <Link
              key={c.id}
              to={`/cases/${c.id}`}
              className="oa-panel group block min-w-0 p-5 transition hover:border-primary-500/40 hover:bg-surface-800/55"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
                    <input
                      type="checkbox"
                      aria-label={`Select investigation ${c.id}`}
                      checked={selectedIds.has(c.id)}
                      disabled={pendingIds.has(c.id)}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); }}
                      onChange={() => toggleSelect(c.id)}
                      className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500 disabled:opacity-40"
                    />
                    <StatusBadge tone={alertSeverityTones[c.severity] ?? 'neutral'}>{c.severity}</StatusBadge>
                    <StatusBadge tone={caseStatusTones[c.status] ?? 'neutral'}>{c.status}</StatusBadge>
                    <select
                      aria-label={`Set status for case ${c.id}`}
                      value={c.status}
                      disabled={updatingStatusId !== null}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); }}
                      onChange={e => { e.preventDefault(); void changeCaseStatus(c, e.target.value); }}
                      className="min-h-7 rounded border border-surface-600 bg-surface-950 px-1.5 text-xs text-surface-300 disabled:opacity-40"
                    >
                      {CASE_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    {c.confidence_score && (
                      <span className="text-xs text-surface-500">
                        {Math.round(c.confidence_score * 100)}% confidence
                      </span>
                    )}
                  </div>
                  <h3 className="text-surface-50 font-medium truncate">{c.title}</h3>
                  {c.summary && <p className="text-surface-400 text-sm mt-1 line-clamp-2">{c.summary}</p>}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-surface-500">
                    <span>{c.alert_count} alerts</span>
                    <span>{c.event_count} events</span>
                    {c.mitre_tactics && c.mitre_tactics.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        {c.mitre_tactics.length} MITRE tactics
                      </span>
                    )}
                    <span>{new Date(c.created_at).toLocaleDateString()}</span>
                    <span className="capitalize">{c.created_by}</span>
                    {c.assigned_to_email && <span>Assigned to {c.assigned_to_email}</span>}
                    {c.due_date && (
                      <span className={isOverdue(c) ? 'text-red-400 font-medium' : ''}>
                        Due {new Date(`${c.due_date}T00:00:00`).toLocaleDateString()}{isOverdue(c) ? ' (overdue)' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-surface-600 group-hover:text-primary-400 transition-colors mt-1" />
              </div>
            </Link>
          ))}
        </div>
        </div>
      )}

      {!loading && !error && cases.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-surface-500">Page {page} of {Math.max(1, Math.ceil(total / 20))}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="px-3 py-1 text-xs bg-surface-700 text-surface-300 rounded disabled:opacity-30">Prev</button>
            <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 20)}
              className="px-3 py-1 text-xs bg-surface-700 text-surface-300 rounded disabled:opacity-30">Next</button>
          </div>
        </div>
      )}

      {showNewCase && (
        <NewCaseDialog
          busy={creatingCase}
          onCancel={() => setShowNewCase(false)}
          onCreate={(title, summary, severity) => void handleCreateCase(title, summary, severity)}
        />
      )}

      {closeReview && <CaseListCloseReview caseIds={closeReview.ids} targetStatus={closeReview.target} onClose={() => { setCloseReview(null); void fetchCases(); }} onChanged={ids => { setSelectedIds(current => new Set([...current].filter(id => !ids.includes(id)))); void fetchCases(); }} />}
      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Delete ${selectedIds.size} investigations?`}
          description="Deleting removes the investigations and their timelines. Linked alerts stay untouched. This cannot be undone."
          confirmLabel={`Delete ${selectedIds.size}`}
          tone="danger"
          busy={bulkBusy}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={() => void handleBulkDelete()}
        />
      )}
    </div>
  );
}

interface NewCaseDialogProps {
  busy: boolean;
  onCancel: () => void;
  onCreate: (title: string, summary: string, severity: string) => void;
}

// Dialog for opening an investigation manually. Kept as its own component so
// focus management mounts with the dialog and field state resets on close.
function NewCaseDialog({ busy, onCancel, onCreate }: NewCaseDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState('medium');
  useDialogFocus(dialogRef, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={() => { if (!busy) onCancel(); }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-case-dialog-title"
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]"
      >
        <h2 id="new-case-dialog-title" className="text-lg font-semibold text-surface-50">New investigation</h2>
        <p className="mt-1 text-sm text-surface-400">Open a case manually when you spot something the agents have not correlated yet.</p>
        <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); onCreate(title.trim(), summary.trim(), severity); }}>
          <div>
            <label htmlFor="new-case-title" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Title</label>
            <input id="new-case-title" type="text" autoComplete="off" value={title} onChange={event => setTitle(event.target.value)} placeholder="What are you investigating?" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div>
            <label htmlFor="new-case-summary" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Summary</label>
            <textarea id="new-case-summary" rows={3} value={summary} onChange={event => setSummary(event.target.value)} placeholder="Optional context for the team" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div>
            <label htmlFor="new-case-severity" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Severity</label>
            <select id="new-case-severity" value={severity} onChange={event => setSeverity(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
              <option value="info">Info</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{busy ? 'Opening…' : 'Open investigation'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
