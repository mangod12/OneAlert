import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { ArrowLeft, Brain, AlertTriangle, Activity, Clock, Target } from 'lucide-react';
import clsx from 'clsx';

const severityColors: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-surface-500/20 text-surface-400 border-surface-500/30',
};

const timelineIcons: Record<string, typeof Brain> = {
  ai_analysis: Brain,
  alert: AlertTriangle,
  event: Activity,
  action: Target,
  note: Clock,
};

interface TimelineEntry {
  id: number;
  timestamp: string;
  entry_type: string;
  content: string;
  source: string;
  metadata_json: Record<string, unknown> | null;
}

interface CaseData {
  id: number;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  confidence_score: number | null;
  mitre_tactics: string[] | null;
  mitre_techniques: Array<{ id: string; name: string; confidence?: number }> | null;
  attack_narrative: string | null;
  created_by: string;
  created_at: string;
  alert_count: number;
  event_count: number;
  timeline: TimelineEntry[];
}

export function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [caseRes, alertsRes, eventsRes] = await Promise.all([
          apiClient.get(`/cases/${caseId}`),
          apiClient.get(`/cases/${caseId}/alerts`),
          apiClient.get(`/cases/${caseId}/events`),
        ]);
        setCaseData(caseRes.data);
        setAlerts(alertsRes.data);
        setEvents(eventsRes.data);
      } catch (err) {
        console.error('Failed to load case', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [caseId]);

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 bg-surface-800 rounded w-1/3" />
      <div className="h-40 bg-surface-800 rounded" />
    </div>;
  }

  if (!caseData) {
    return <div className="text-center py-20 text-surface-400">Case not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link to="/cases" className="flex items-center gap-2 text-surface-400 hover:text-white text-sm mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Cases
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={clsx('px-2.5 py-1 text-xs font-medium rounded-full border', severityColors[caseData.severity])}>
                {caseData.severity}
              </span>
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-surface-700 text-surface-300">
                {caseData.status}
              </span>
              {caseData.confidence_score && (
                <span className="text-sm text-surface-400">
                  {Math.round(caseData.confidence_score * 100)}% confidence
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white">{caseData.title}</h1>
            {caseData.summary && <p className="text-surface-400 mt-2">{caseData.summary}</p>}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <p className="text-xs text-surface-500 uppercase">Alerts</p>
          <p className="text-2xl font-bold text-white mt-1">{caseData.alert_count}</p>
        </div>
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <p className="text-xs text-surface-500 uppercase">Events</p>
          <p className="text-2xl font-bold text-white mt-1">{caseData.event_count}</p>
        </div>
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <p className="text-xs text-surface-500 uppercase">MITRE Tactics</p>
          <p className="text-2xl font-bold text-white mt-1">{caseData.mitre_tactics?.length || 0}</p>
        </div>
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <p className="text-xs text-surface-500 uppercase">Created By</p>
          <p className="text-lg font-medium text-primary-400 mt-1 capitalize">{caseData.created_by}</p>
        </div>
      </div>

      {/* Attack Narrative */}
      {caseData.attack_narrative && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-3">
            <Brain className="w-5 h-5 text-primary-400" /> AI Analysis
          </h2>
          <p className="text-surface-300 leading-relaxed whitespace-pre-wrap">{caseData.attack_narrative}</p>
        </div>
      )}

      {/* MITRE Techniques */}
      {caseData.mitre_techniques && caseData.mitre_techniques.length > 0 && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-3">
            <Target className="w-5 h-5 text-primary-400" /> MITRE ATT&CK Techniques
          </h2>
          <div className="flex flex-wrap gap-2">
            {caseData.mitre_techniques.map((t, i) => (
              <span key={i} className="px-3 py-1.5 bg-primary-600/20 text-primary-300 text-sm rounded-lg border border-primary-500/20">
                {t.id}: {t.name}
                {t.confidence && <span className="ml-2 text-primary-500 text-xs">({Math.round(t.confidence * 100)}%)</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout: Timeline + Related Items */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2">
          <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Investigation Timeline</h2>
            {caseData.timeline.length === 0 ? (
              <p className="text-surface-500">No timeline entries yet.</p>
            ) : (
              <div className="space-y-4">
                {caseData.timeline.map((entry) => {
                  const Icon = timelineIcons[entry.entry_type] || Clock;
                  return (
                    <div key={entry.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-surface-700 flex items-center justify-center">
                          <Icon className="w-4 h-4 text-primary-400" />
                        </div>
                        <div className="flex-1 w-px bg-surface-700 mt-2" />
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-surface-500">{new Date(entry.timestamp).toLocaleString()}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-700 text-surface-400">{entry.entry_type}</span>
                          <span className="text-xs text-surface-600">{entry.source}</span>
                        </div>
                        <p className="text-surface-300 text-sm">{entry.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Related Alerts & Events */}
        <div className="space-y-6">
          <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-3">Related Alerts</h2>
            {alerts.length === 0 ? (
              <p className="text-surface-500 text-sm">No linked alerts.</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((a: any) => (
                  <div key={a.id} className="p-3 bg-surface-900/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx('px-1.5 py-0.5 text-xs rounded', severityColors[a.severity])}>{a.severity}</span>
                      {a.cve_id && <span className="text-xs text-primary-400">{a.cve_id}</span>}
                    </div>
                    <p className="text-sm text-surface-300 truncate">{a.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-3">Related Events</h2>
            {events.length === 0 ? (
              <p className="text-surface-500 text-sm">No linked events.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {events.map((e: any) => (
                  <div key={e.id} className="p-3 bg-surface-900/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx('px-1.5 py-0.5 text-xs rounded', severityColors[e.severity])}>{e.severity}</span>
                      <span className="text-xs text-surface-500">{e.event_type}</span>
                    </div>
                    <p className="text-xs text-surface-400">
                      {e.source_ip} → {e.dest_ip} {e.signature && `| ${e.signature}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
