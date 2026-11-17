import { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { ArrowLeft, Brain, AlertTriangle, Activity, Clock, Target, Network, GitBranch, Link2, X, Pencil } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { toast } from '../components/Toast';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { useDialogFocus } from '../components/ui/useDialogFocus';
import { StatusBadge } from '../components/ui/StatusBadge';
import { NarrativeText } from '../components/ui/NarrativeText';
import { alertSeverityTones, caseStatusTones, eventSeverityTones } from '../components/ui/tones';

const timelineIcons: Record<string, typeof Brain> = {
  ai_analysis: Brain,
  alert: AlertTriangle,
  event: Activity,
  action: Target,
  note: Clock,
};

// Forward and backward status transitions an analyst can take on a case.
const NEXT_STATUSES: Record<string, Array<{ status: string; label: string }>> = {
  open: [
    { status: 'investigating', label: 'Start investigating' },
    { status: 'resolved', label: 'Resolve' },
  ],
  investigating: [
    { status: 'resolved', label: 'Resolve' },
    { status: 'open', label: 'Back to open' },
  ],
  resolved: [
    { status: 'closed', label: 'Close' },
    { status: 'investigating', label: 'Reopen' },
  ],
  closed: [{ status: 'open', label: 'Reopen' }],
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
  assigned_to_id: number | null;
  assigned_to_email: string | null;
  timeline: TimelineEntry[];
}
interface RelatedAlert { id: number; severity: string; cve_id?: string | null; title: string; }
interface BlastRadiusNode { id: string; type: string; label: string; asset_type?: string; zone?: string | null; is_ot?: boolean; criticality?: string | null; direction?: string; }
interface BlastRadius {
  case_id: number;
  nodes: BlastRadiusNode[];
  edges: Array<{ from: string; to: string; label: string }>;
  summary: { total_nodes: number; assets_affected: number; ips_involved: number; techniques_used: number };
}
interface SimilarCase { case_id: number; title: string; similarity: number; shared_techniques: string[]; }
interface RelatedEvent { id: number; severity: string; event_type: string; source_ip?: string | null; dest_ip?: string | null; signature?: string | null; }

export function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [alerts, setAlerts] = useState<RelatedAlert[]>([]);
  const [events, setEvents] = useState<RelatedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [degraded, setDegraded] = useState<string[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [blastRadius, setBlastRadius] = useState<BlastRadius | null>(null);
  const [similarCases, setSimilarCases] = useState<SimilarCase[]>([]);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showLinkAlert, setShowLinkAlert] = useState(false);
  const [alertOptions, setAlertOptions] = useState<RelatedAlert[]>([]);
  const [linkingAlert, setLinkingAlert] = useState(false);
  const [showLinkEvent, setShowLinkEvent] = useState(false);
  const [eventOptions, setEventOptions] = useState<RelatedEvent[]>([]);
  const [linkingEvent, setLinkingEvent] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [changingSeverity, setChangingSeverity] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [members, setMembers] = useState<Array<{ id: number; email: string; full_name: string | null; is_active: boolean }>>([]);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    apiClient.get('/orgs/me/members')
      .then(res => setMembers((res.data as Array<{ id: number; email: string; full_name: string | null; is_active: boolean }>).filter(m => m.is_active)))
      .catch(() => setMembers([]));
  }, []);

  const changeAssignee = async (value: string) => {
    if (assigning) return;
    setAssigning(true);
    const userId = value === '' ? null : Number(value);
    try {
      await apiClient.post(`/cases/${caseId}/assign`, { user_id: userId });
      toast(userId === null ? 'Case unassigned.' : 'Case assigned.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The case could not be assigned.'), 'error'); }
    finally { setAssigning(false); }
  };

  const changeStatus = async (status: string) => {
    if (updatingStatus) return;
    setUpdatingStatus(true);
    try {
      await apiClient.patch(`/cases/${caseId}`, null, { params: { status_update: status } });
      toast(`Case marked ${status}`, 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'Case status could not be updated.'), 'error'); }
    finally { setUpdatingStatus(false); }
  };

  const changeSeverity = async (severity: string) => {
    if (changingSeverity || severity === caseData?.severity) return;
    setChangingSeverity(true);
    try {
      await apiClient.patch(`/cases/${caseId}`, null, { params: { severity } });
      toast(`Severity set to ${severity}`, 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'Case severity could not be updated.'), 'error'); }
    finally { setChangingSeverity(false); }
  };

  const saveDetails = async (title: string, summary: string) => {
    try {
      await apiClient.patch(`/cases/${caseId}`, null, { params: { title, summary } });
      setShowEdit(false);
      toast('Case details updated.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'Case details could not be updated.'), 'error'); }
  };

  const openLinkAlert = async () => {
    setShowLinkAlert(true);
    try {
      const res = await apiClient.get('/alerts/', { params: { size: 20 } });
      const linked = new Set(alerts.map(a => a.id));
      setAlertOptions(((res.data.alerts ?? []) as RelatedAlert[]).filter(a => !linked.has(a.id)));
    } catch (err) { toast(getApiErrorMessage(err, 'Recent alerts could not be loaded.'), 'error'); }
  };

  const linkAlert = async (alertId: number) => {
    if (linkingAlert) return;
    setLinkingAlert(true);
    try {
      await apiClient.post(`/cases/${caseId}/alerts/${alertId}`);
      setShowLinkAlert(false);
      toast('Alert linked to the case.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The alert could not be linked.'), 'error'); }
    finally { setLinkingAlert(false); }
  };

  const openLinkEvent = async () => {
    setShowLinkEvent(true);
    try {
      const res = await apiClient.get('/events/', { params: { size: 20 } });
      const linked = new Set(events.map(e => e.id));
      setEventOptions(((res.data.events ?? []) as RelatedEvent[]).filter(e => !linked.has(e.id)));
    } catch (err) { toast(getApiErrorMessage(err, 'Recent events could not be loaded.'), 'error'); }
  };

  const linkEvent = async (eventId: number) => {
    if (linkingEvent) return;
    setLinkingEvent(true);
    try {
      await apiClient.post(`/cases/${caseId}/events/${eventId}`);
      setShowLinkEvent(false);
      toast('Event linked to the case.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The event could not be linked.'), 'error'); }
    finally { setLinkingEvent(false); }
  };

  const unlinkItem = async (kind: 'alerts' | 'events', id: number) => {
    const key = `${kind}-${id}`;
    if (unlinkingId) return;
    setUnlinkingId(key);
    try {
      await apiClient.delete(`/cases/${caseId}/${kind}/${id}`);
      toast(`${kind === 'alerts' ? 'Alert' : 'Event'} unlinked from the case.`, 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The link could not be removed.'), 'error'); }
    finally { setUnlinkingId(null); }
  };

  const addNote = async () => {
    const content = noteText.trim();
    if (!content || addingNote) return;
    setAddingNote(true);
    try {
      await apiClient.post(`/cases/${caseId}/notes`, { content });
      setNoteText('');
      toast('Note added to the timeline.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The note could not be added.'), 'error'); }
    finally { setAddingNote(false); }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [caseResult, alertsResult, eventsResult, blastResult, similarResult] = await Promise.allSettled([
      apiClient.get(`/cases/${caseId}`), apiClient.get(`/cases/${caseId}/alerts`), apiClient.get(`/cases/${caseId}/events`),
      apiClient.get(`/cases/${caseId}/blast-radius`), apiClient.get(`/cases/${caseId}/similar`),
    ]);
    if (caseResult.status === 'rejected') {
      setError(getApiErrorMessage(caseResult.reason, 'This case could not be loaded.'));
      setCaseData(null);
    } else {
      setCaseData(caseResult.value.data);
      setError('');
    }
    const partial: string[] = [];
    if (alertsResult.status === 'fulfilled') setAlerts(alertsResult.value.data);
    else { setAlerts([]); partial.push('Linked alerts unavailable'); }
    if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value.data);
    else { setEvents([]); partial.push('Linked events unavailable'); }
    if (blastResult.status === 'fulfilled') setBlastRadius(blastResult.value.data?.data ?? null);
    else setBlastRadius(null);
    if (similarResult.status === 'fulfilled') setSimilarCases(similarResult.value.data?.data ?? []);
    else setSimilarCases([]);
    setDegraded(partial);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  if (loading) {
    return <LoadingSurface rows={6} label="Loading case investigation" />;
  }

  if (!caseData) {
    return <ErrorState title="Case unavailable" description={error || 'The case may have been removed or you may not have access.'} action={<RetryButton onClick={fetchAll} />} />;
  }

  return (
    <div className="space-y-6">
      {degraded.length > 0 && <DegradedBanner messages={degraded} onRetry={fetchAll} />}
      {/* Header */}
      <div>
        <Link to="/cases" className="flex items-center gap-2 text-surface-400 hover:text-surface-50 text-sm mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Cases
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge tone={alertSeverityTones[caseData.severity] ?? 'neutral'}>{caseData.severity}</StatusBadge>
              <StatusBadge tone={caseStatusTones[caseData.status] ?? 'neutral'}>{caseData.status}</StatusBadge>
              <select
                aria-label="Change case severity"
                value={caseData.severity}
                disabled={changingSeverity}
                onChange={e => void changeSeverity(e.target.value)}
                className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200 disabled:opacity-40"
              >
                {['info', 'low', 'medium', 'high', 'critical'].map(sev => <option key={sev} value={sev}>{sev}</option>)}
              </select>
              {members.length > 0 && (
                <select
                  aria-label="Assign case"
                  value={caseData.assigned_to_id ?? ''}
                  disabled={assigning}
                  onChange={e => void changeAssignee(e.target.value)}
                  className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200 disabled:opacity-40"
                >
                  <option value="">Unassigned</option>
                  {members.map(member => (
                    <option key={member.id} value={member.id}>{member.full_name ? `${member.full_name} (${member.email})` : member.email}</option>
                  ))}
                </select>
              )}
              {caseData.confidence_score && (
                <span className="text-sm text-surface-400">
                  {Math.round(caseData.confidence_score * 100)}% confidence
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-surface-50">{caseData.title}</h1>
              <button
                type="button"
                aria-label="Edit case details"
                onClick={() => setShowEdit(true)}
                className="grid h-9 w-9 place-items-center rounded-md text-surface-400 hover:bg-surface-800 hover:text-surface-50"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {caseData.summary && <p className="text-surface-400 mt-2">{caseData.summary}</p>}
          </div>
          {(NEXT_STATUSES[caseData.status] ?? []).length > 0 && (
            <div className="flex shrink-0 gap-2" aria-label="Case status actions">
              {(NEXT_STATUSES[caseData.status] ?? []).map(action => (
                <button
                  key={action.status}
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => void changeStatus(action.status)}
                  className="rounded-md border border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-200 transition-colors hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="oa-panel p-4">
          <p className="text-xs text-surface-500 uppercase">Alerts</p>
          <p className="text-2xl font-bold text-surface-50 mt-1">{caseData.alert_count}</p>
        </div>
        <div className="oa-panel p-4">
          <p className="text-xs text-surface-500 uppercase">Events</p>
          <p className="text-2xl font-bold text-surface-50 mt-1">{caseData.event_count}</p>
        </div>
        <div className="oa-panel p-4">
          <p className="text-xs text-surface-500 uppercase">MITRE Tactics</p>
          <p className="text-2xl font-bold text-surface-50 mt-1">{caseData.mitre_tactics?.length || 0}</p>
        </div>
        <div className="oa-panel p-4">
          <p className="text-xs text-surface-500 uppercase">Created By</p>
          <p className="text-lg font-medium text-primary-400 mt-1 capitalize">{caseData.created_by}</p>
        </div>
      </div>

      {/* Attack Narrative */}
      {caseData.attack_narrative && (
        <div className="oa-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50 mb-3">
            <Brain className="w-5 h-5 text-primary-400" /> AI Analysis
          </h2>
          <NarrativeText text={caseData.attack_narrative} />
        </div>
      )}

      {/* MITRE Techniques */}
      {caseData.mitre_techniques && caseData.mitre_techniques.length > 0 && (
        <div className="oa-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50 mb-3">
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

      {/* Blast Radius */}
      {blastRadius && (blastRadius.summary.assets_affected > 0 || blastRadius.summary.ips_involved > 0) && (
        <div className="oa-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50 mb-3">
            <Network className="w-5 h-5 text-primary-400" /> Blast Radius
          </h2>
          <div className="flex flex-wrap gap-4 mb-4 text-sm text-surface-400">
            <span>{blastRadius.summary.assets_affected} assets affected</span>
            <span>{blastRadius.summary.ips_involved} IPs involved</span>
            <span>{blastRadius.summary.techniques_used} techniques used</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {blastRadius.nodes.filter(n => n.type === 'asset').map(n => (
              <span key={n.id} className="rounded-md border border-surface-700 bg-surface-800/50 px-3 py-1.5 text-sm text-surface-200">
                {n.label}
                {n.zone && <span className="ml-2 text-xs text-surface-500">{n.zone}</span>}
                {n.is_ot && <span className="ml-2 text-xs text-warning">OT</span>}
                {n.criticality && <span className="ml-2 text-xs text-surface-500">{n.criticality}</span>}
              </span>
            ))}
            {blastRadius.nodes.filter(n => n.type === 'ip').map(n => (
              <span key={n.id} className="rounded-md border border-surface-700 bg-surface-800/50 px-3 py-1.5 font-mono text-xs text-surface-300">
                {n.label}
                {n.direction && <span className="ml-2 text-surface-500">{n.direction}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Similar Investigations */}
      {similarCases.length > 0 && (
        <div className="oa-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50 mb-3">
            <GitBranch className="w-5 h-5 text-primary-400" /> Similar Investigations
          </h2>
          <div className="space-y-2">
            {similarCases.map(similar => (
              <Link
                key={similar.case_id}
                to={`/cases/${similar.case_id}`}
                className="block rounded-md border border-surface-700 bg-surface-800/50 p-3 transition-colors hover:border-primary-500/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-surface-100">{similar.title}</span>
                  <span className="shrink-0 text-xs text-primary-300">{Math.round(similar.similarity * 100)}% similar</span>
                </div>
                {similar.shared_techniques.length > 0 && (
                  <p className="mt-1 text-xs text-surface-500">Shared techniques: {similar.shared_techniques.join(', ')}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout: Timeline + Related Items */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2">
          <div className="oa-panel p-6">
            <h2 className="text-lg font-semibold text-surface-50 mb-4">Investigation Timeline</h2>
            <form className="mb-4 flex items-start gap-2" onSubmit={e => { e.preventDefault(); void addNote(); }}>
              <label htmlFor="case-note" className="sr-only">Add a timeline note</label>
              <textarea
                id="case-note"
                rows={2}
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add an investigation note…"
                className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
              />
              <button type="submit" disabled={addingNote || !noteText.trim()} className="min-h-9 rounded-md bg-primary-500 px-3 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">
                {addingNote ? 'Adding…' : 'Add note'}
              </button>
            </form>
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
          <div className="oa-panel p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-surface-50">Related Alerts</h2>
              <button type="button" onClick={() => void openLinkAlert()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800">
                <Link2 className="w-3.5 h-3.5" /> Link alert
              </button>
            </div>
            {alerts.length === 0 ? (
              <p className="text-surface-500 text-sm">No linked alerts.</p>
            ) : (
              <div className="space-y-2">
                {alerts.map(a => (
                  <div key={a.id} className="p-3 bg-surface-900/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge tone={alertSeverityTones[a.severity] ?? 'neutral'}>{a.severity}</StatusBadge>
                      {a.cve_id && <span className="text-xs text-primary-400">{a.cve_id}</span>}
                      <button
                        type="button"
                        aria-label={`Unlink alert ${a.title}`}
                        disabled={unlinkingId !== null}
                        onClick={() => void unlinkItem('alerts', a.id)}
                        className="ml-auto text-surface-500 hover:text-danger disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm text-surface-300 truncate">{a.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="oa-panel p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-surface-50">Related Events</h2>
              <button type="button" onClick={() => void openLinkEvent()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800">
                <Link2 className="w-3.5 h-3.5" /> Link event
              </button>
            </div>
            {events.length === 0 ? (
              <p className="text-surface-500 text-sm">No linked events.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {events.map(e => (
                  <div key={e.id} className="p-3 bg-surface-900/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge tone={eventSeverityTones[e.severity] ?? 'neutral'}>{e.severity}</StatusBadge>
                      <span className="text-xs text-surface-500">{e.event_type}</span>
                      <button
                        type="button"
                        aria-label={`Unlink event ${e.signature ?? e.event_type}`}
                        disabled={unlinkingId !== null}
                        onClick={() => void unlinkItem('events', e.id)}
                        className="ml-auto text-surface-500 hover:text-danger disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
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

      {showEdit && (
        <EditCaseDialog
          initialTitle={caseData.title}
          initialSummary={caseData.summary ?? ''}
          onCancel={() => setShowEdit(false)}
          onSave={(title, summary) => void saveDetails(title, summary)}
        />
      )}

      {showLinkAlert && (
        <LinkAlertDialog
          options={alertOptions}
          busy={linkingAlert}
          onCancel={() => setShowLinkAlert(false)}
          onLink={alertId => void linkAlert(alertId)}
        />
      )}

      {showLinkEvent && (
        <LinkEventDialog
          options={eventOptions}
          busy={linkingEvent}
          onCancel={() => setShowLinkEvent(false)}
          onLink={eventId => void linkEvent(eventId)}
        />
      )}
    </div>
  );
}

interface LinkAlertDialogProps {
  options: RelatedAlert[];
  busy: boolean;
  onCancel: () => void;
  onLink: (alertId: number) => void;
}

// Dialog for attaching a recent alert to the case. Kept as its own component
// so focus management mounts with the dialog and the selection resets on close.
function LinkAlertDialog({ options, busy, onCancel, onLink }: LinkAlertDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState('');
  useDialogFocus(dialogRef, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={() => { if (!busy) onCancel(); }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-alert-dialog-title"
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]"
      >
        <h2 id="link-alert-dialog-title" className="text-lg font-semibold text-surface-50">Link an alert</h2>
        <p className="mt-1 text-sm text-surface-400">Attach a recent alert to this investigation.</p>
        {options.length === 0 ? (
          <p className="mt-4 text-sm text-surface-500">Every recent alert is already linked.</p>
        ) : (

          <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); if (selectedId) onLink(Number(selectedId)); }}>
            <label htmlFor="link-alert-select" className="sr-only">Alert to link</label>
            <select id="link-alert-select" value={selectedId} onChange={event => setSelectedId(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
              <option value="">Choose an alert…</option>
              {options.map(a => <option key={a.id} value={a.id}>{a.title} ({a.severity})</option>)}
            </select>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onCancel} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
              <button type="submit" disabled={busy || !selectedId} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{busy ? 'Linking…' : 'Link alert'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface LinkEventDialogProps {
  options: RelatedEvent[];
  busy: boolean;
  onCancel: () => void;
  onLink: (eventId: number) => void;
}

// Dialog for attaching a recent event to the case, mirroring LinkAlertDialog.
function LinkEventDialog({ options, busy, onCancel, onLink }: LinkEventDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState('');
  useDialogFocus(dialogRef, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={() => { if (!busy) onCancel(); }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-event-dialog-title"
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]"
      >
        <h2 id="link-event-dialog-title" className="text-lg font-semibold text-surface-50">Link an event</h2>
        <p className="mt-1 text-sm text-surface-400">Attach a recent security event to this investigation.</p>
        {options.length === 0 ? (
          <p className="mt-4 text-sm text-surface-500">Every recent event is already linked.</p>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); if (selectedId) onLink(Number(selectedId)); }}>
            <label htmlFor="link-event-select" className="sr-only">Event to link</label>
            <select id="link-event-select" value={selectedId} onChange={event => setSelectedId(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
              <option value="">Choose an event…</option>
              {options.map(e => <option key={e.id} value={e.id}>{(e.signature ?? e.event_type)} ({e.severity})</option>)}
            </select>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onCancel} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
              <button type="submit" disabled={busy || !selectedId} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{busy ? 'Linking…' : 'Link event'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}


interface EditCaseDialogProps {
  initialTitle: string;
  initialSummary: string;
  onCancel: () => void;
  onSave: (title: string, summary: string) => void;
}

// Dialog for renaming a case and editing its summary. Own component so focus
// management mounts with the dialog and fields reset on close.
function EditCaseDialog({ initialTitle, initialSummary, onCancel, onSave }: EditCaseDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState(false);
  useDialogFocus(dialogRef, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={() => { if (!busy) onCancel(); }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-case-dialog-title"
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]"
      >
        <h2 id="edit-case-dialog-title" className="text-lg font-semibold text-surface-50">Edit case details</h2>
        <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); setBusy(true); onSave(title.trim(), summary.trim()); setBusy(false); }}>
          <div>
            <label htmlFor="edit-case-title" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Title</label>
            <input id="edit-case-title" type="text" autoComplete="off" value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div>
            <label htmlFor="edit-case-summary" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Summary</label>
            <textarea id="edit-case-summary" rows={3} value={summary} onChange={event => setSummary(event.target.value)} placeholder="Optional context for the team" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
