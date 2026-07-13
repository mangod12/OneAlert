import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { Play, Shield, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/Toast';

const severityColors: Record<string, string> = {
  critical: 'bg-danger/10 text-danger border-danger/30',
  high: 'bg-warning/10 text-warning border-warning/30',
  medium: 'bg-info/10 text-info border-info/30',
  low: 'bg-success/10 text-success border-success/30',
  info: 'bg-surface-500/20 text-surface-400 border-surface-500/30',
};

const statusColors: Record<string, string> = {
  open: 'bg-red-500/20 text-red-400',
  investigating: 'bg-yellow-500/20 text-yellow-400',
  resolved: 'bg-green-500/20 text-green-400',
  closed: 'bg-surface-500/20 text-surface-400',
  false_positive: 'bg-surface-500/20 text-surface-500',
};

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

export function Cases() {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [triaging, setTriaging] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
              className="oa-panel group block p-5 transition hover:border-primary-500/40 hover:bg-surface-800/55"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full border', severityColors[c.severity])}>
                      {c.severity}
                    </span>
                    <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', statusColors[c.status])}>
                      {c.status}
                    </span>
                    {c.confidence_score && (
                      <span className="text-xs text-surface-500">
                        {Math.round(c.confidence_score * 100)}% confidence
                      </span>
                    )}
                  </div>
                  <h3 className="text-white font-medium truncate">{c.title}</h3>
                  {c.summary && <p className="text-surface-400 text-sm mt-1 line-clamp-2">{c.summary}</p>}
                  <div className="flex items-center gap-4 mt-3 text-xs text-surface-500">
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
