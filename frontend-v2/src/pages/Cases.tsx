import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { BriefcaseMedical, Play, Shield, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

const severityColors: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
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

  const fetchCases = async () => {
    try {
      const res = await apiClient.get('/cases/', { params: { size: 50 } });
      setCases(res.data.cases);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load cases', err);
    } finally {
      setLoading(false);
    }
  };

  const runTriage = async () => {
    setTriaging(true);
    try {
      await apiClient.post('/cases/auto-triage', null, { params: { hours_back: 72 } });
      await fetchCases();
    } catch (err) {
      console.error('Triage failed', err);
    } finally {
      setTriaging(false);
    }
  };

  useEffect(() => { fetchCases(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Investigations</h1>
          <p className="text-surface-400 text-sm mt-1">{total} cases — AI-correlated from alerts and events</p>
        </div>
        <button
          onClick={runTriage}
          disabled={triaging}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Play className="w-4 h-4" />
          {triaging ? 'Running Triage...' : 'Run AI Triage'}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface-800/50 rounded-xl p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : cases.length === 0 ? (
        <div className="text-center py-20">
          <BriefcaseMedical className="w-16 h-16 text-surface-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-surface-300">No cases yet</h3>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Run AI Triage to automatically correlate your alerts and security events into investigation cases.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {cases.map(c => (
            <Link
              key={c.id}
              to={`/cases/${c.id}`}
              className="block bg-surface-800/50 border border-surface-700 rounded-xl p-5 hover:border-primary-500/30 transition-colors group"
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
