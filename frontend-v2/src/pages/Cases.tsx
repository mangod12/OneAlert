import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { Play, Search, Shield, ChevronRight, X } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
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
}

interface CaseSearchResult {
  case_id: number;
  title: string;
  score: number;
  snippet: string;
}

export function Cases() {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [triaging, setTriaging] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CaseSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const fetchCases = async () => {
    setError(null);
    try {
      const res = await apiClient.get('/cases/', { params: { size: 50 } });
      setCases(res.data.cases);
      setTotal(res.data.total);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Investigations could not be loaded.'));
    } finally {
      setLoading(false);
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

  useEffect(() => { fetchCases(); }, []);

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
        <button
          onClick={runTriage}
          disabled={triaging}
          className="flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          {triaging ? 'Running triage…' : 'Run AI triage'}
        </button>
      } />

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
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-surface-600 group-hover:text-primary-400 transition-colors mt-1" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
