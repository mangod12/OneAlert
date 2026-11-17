import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { Play, Plus, Search, Shield, ChevronRight, X } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { useDialogFocus } from '../components/ui/useDialogFocus';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { alertSeverityTones, caseStatusTones } from '../components/ui/tones';
import { toast } from '../components/Toast';

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
}

interface CaseSearchResult {
  case_id: number;
  title: string;
  score: number;
  snippet: string;
}

interface PipelineStageResult {
  summary?: string;
  error?: string;
}

interface PipelineResult {
  detect: PipelineStageResult | null;
  triage: PipelineStageResult | null;
  total_duration_ms: number;
  pipeline_status: string;
}

const CASE_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const;

export function Cases() {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [triaging, setTriaging] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CaseSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pipelining, setPipelining] = useState(false);
  const [pipelineLookback, setPipelineLookback] = useState(24);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [showNewCase, setShowNewCase] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [sort, setSort] = useState('created_at_desc');
  const [page, setPage] = useState(1);

  const fetchCases = async () => {
    setError(null);
    try {
      const res = await apiClient.get('/cases/', {
        params: {
          page,
          size: 20,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(severityFilter ? { severity: severityFilter } : {}),
          sort,
        },
      });
      setCases(res.data.cases);
      setTotal(res.data.total);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Investigations could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

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
      await fetchCases();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The detection pipeline could not be run.'), 'error');
    } finally {
      setPipelining(false);
    }
  };

  const runTriage = async () => {
    setTriaging(true);
    try {
      await apiClient.post('/cases/auto-triage', null, { params: { hours_back: 72 } });
      await fetchCases();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'AI triage could not be started.'), 'error');
    } finally {
      setTriaging(false);
    }
  };

  useEffect(() => { fetchCases(); }, [statusFilter, severityFilter, sort, page]);

  const changeCaseStatus = async (c: CaseItem, status: string) => {
    if (updatingStatusId !== null || status === c.status) return;
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

  const runSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2 || searching) {
      if (q.length > 0 && q.length < 2) toast('Type at least 2 characters to search.', 'info');
      return;
    }
    setSearching(true);
    try {
      const res = await apiClient.get('/cases/search', { params: { q } });
      setSearchResults(res.data.data ?? []);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The search could not be completed.'), 'error');
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Command" title="Investigations" description={`${total} cases correlated from alerts, security events, and agent analysis.`} actions={
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

      {pipelineResult && (
        <div role="status" className="rounded-md border border-surface-700 bg-surface-900/60 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-surface-100">Pipeline finished in {(pipelineResult.total_duration_ms / 1000).toFixed(1)}s</p>
              <p className="text-surface-300">Detect: {pipelineResult.detect?.summary ?? pipelineResult.detect?.error ?? 'No detect stage result.'}</p>
              <p className="text-surface-300">Triage: {pipelineResult.triage?.summary ?? pipelineResult.triage?.error ?? 'No triage stage result.'}</p>
            </div>
            <button type="button" onClick={() => setPipelineResult(null)} aria-label="Dismiss pipeline result" className="text-surface-400 hover:text-surface-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="flex flex-wrap items-center gap-2">
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
          <label htmlFor="case-sort" className="sr-only">Sort investigations</label>
          <select id="case-sort" value={sort} onChange={e => { setPage(1); setSort(e.target.value); }} className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200">
            <option value="created_at_desc">Newest first</option>
            <option value="created_at_asc">Oldest first</option>
            <option value="severity_desc">Highest severity</option>
            <option value="severity_asc">Lowest severity</option>
          </select>
        </div>
      )}

      {!loading && !error && cases.length > 0 && (
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void runSearch(); }}>
          <label htmlFor="case-search" className="sr-only">Search investigations</label>
          <input
            id="case-search"
            type="text"
            autoComplete="off"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search investigations in plain language…"
            className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
          />
          <button type="submit" disabled={searching} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">
            <Search className="h-4 w-4" /> {searching ? 'Searching…' : 'Search'}
          </button>
          {searchResults !== null && (
            <button type="button" onClick={clearSearch} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">
              <X className="h-4 w-4" /> Clear
            </button>
          )}
        </form>
      )}

      {searchResults !== null && (
        <div className="oa-panel p-5">
          <h2 className="mb-3 text-sm font-semibold text-surface-100">{searchResults.length} result{searchResults.length === 1 ? '' : 's'} for this search</h2>
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
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-surface-600 group-hover:text-primary-400 transition-colors mt-1" />
              </div>
            </Link>
          ))}
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
