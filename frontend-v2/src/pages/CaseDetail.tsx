import { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MentionTextarea } from '../components/MentionTextarea';
import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { ArrowLeft, Brain, AlertTriangle, Activity, Clock, Target, Network, GitBranch, Link2, X, Pencil, Trash2, Download, Shield, Eye, EyeOff, ListChecks, Square, CheckSquare, CheckCircle2 } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { toast } from '../components/Toast';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { useDialogFocus } from '../components/ui/useDialogFocus';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
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

const DONE_CASE_STATUSES = ['resolved', 'closed', 'false_positive'];

interface TimelineEntry {
  id: number;
  timestamp: string;
  entry_type: string;
  content: string;
  source: string;
  author_email: string | null;
  metadata_json: Record<string, unknown> | null;
}

interface CaseData {
  id: number;
  user_id: number;
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
  due_date: string | null;
  closed_at: string | null;
  resolution: string | null;
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
interface CasePlan { id: number; status: string; autonomy_level: string; created_by: string; created_at: string; actions: unknown[]; }
interface CaseWatcher { user_id: number; email: string; full_name: string | null; }
interface CaseTask { id: number; title: string; done: boolean; position: number; assignee_id: number | null; due_date: string | null; created_at: string; completed_at: string | null; }

export function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [searchParams] = useSearchParams();
  const highlightedNoteId = Number(searchParams.get('note')) || null;

  useEffect(() => {
    if (!highlightedNoteId || !caseData) return;
    document.getElementById(`case-note-${highlightedNoteId}`)?.scrollIntoView?.({ block: 'center' });
  }, [caseData, highlightedNoteId]);
  const [alerts, setAlerts] = useState<RelatedAlert[]>([]);
  const [events, setEvents] = useState<RelatedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [degraded, setDegraded] = useState<string[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [pendingClose, setPendingClose] = useState<{ status: string; label: string } | null>(null);
  const [editingResolution, setEditingResolution] = useState(false);
  const [resolutionDraft, setResolutionDraft] = useState('');
  const [savingResolution, setSavingResolution] = useState(false);
  const [blastRadius, setBlastRadius] = useState<BlastRadius | null>(null);
  const [similarCases, setSimilarCases] = useState<SimilarCase[]>([]);
  const [plans, setPlans] = useState<CasePlan[]>([]);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);
  const [pendingDeleteNote, setPendingDeleteNote] = useState<TimelineEntry | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [exportingTimeline, setExportingTimeline] = useState(false);
  const [showLinkAlert, setShowLinkAlert] = useState(false);
  const [alertOptions, setAlertOptions] = useState<RelatedAlert[]>([]);
  const [linkingAlert, setLinkingAlert] = useState(false);
  const [showLinkEvent, setShowLinkEvent] = useState(false);
  const [eventOptions, setEventOptions] = useState<RelatedEvent[]>([]);
  const [linkingEvent, setLinkingEvent] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [changingSeverity, setChangingSeverity] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingCase, setDeletingCase] = useState(false);
  const navigate = useNavigate();
  const [members, setMembers] = useState<Array<{ id: number; email: string; full_name: string | null; is_active: boolean }>>([]);
  const [assigning, setAssigning] = useState(false);
  const [watchers, setWatchers] = useState<CaseWatcher[]>([]);
  const [watchBusy, setWatchBusy] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<number | null>(null);
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => {
    setTodayStr(new Date().toISOString().slice(0, 10));
  }, []);
  const [seedingPlanId, setSeedingPlanId] = useState<number | null>(null);
  const currentUserId = useAuthStore(state => state.user?.id ?? null);

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

  const changeDueDate = async (value: string) => {
    if (savingDueDate) return;
    setSavingDueDate(true);
    try {
      await apiClient.patch(`/cases/${caseId}`, null, { params: { due_date: value } });
      toast(value ? `Due date set to ${value}.` : 'Due date cleared.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The due date could not be updated.'), 'error'); }
    finally { setSavingDueDate(false); }
  };

  const changeStatus = async (status: string, resolution?: string) => {
    if (updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const params: Record<string, string> = { status_update: status };
      if (resolution && resolution.trim()) params.resolution = resolution.trim();
      await apiClient.patch(`/cases/${caseId}`, null, { params });
      toast(`Case marked ${status}`, 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'Case status could not be updated.'), 'error'); }
    finally { setUpdatingStatus(false); }
  };

  const saveResolution = async () => {
    if (savingResolution) return;
    setSavingResolution(true);
    try {
      await apiClient.patch(`/cases/${caseId}`, null, { params: { resolution: resolutionDraft } });
      toast('Resolution updated', 'success');
      setEditingResolution(false);
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The resolution could not be updated.'), 'error'); }
    finally { setSavingResolution(false); }
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

  const addTask = async () => {
    const title = newTaskTitle.trim();
    if (!title || addingTask) return;
    setAddingTask(true);
    try {
      await apiClient.post(`/cases/${caseId}/tasks`, { title });
      setNewTaskTitle('');
      toast('Task added to the checklist.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task could not be added.'), 'error'); }
    finally { setAddingTask(false); }
  };

  const toggleTask = async (task: CaseTask) => {
    if (taskBusyId !== null) return;
    setTaskBusyId(task.id);
    try {
      await apiClient.patch(`/cases/${caseId}/tasks/${task.id}`, { done: !task.done });
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task could not be updated.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const assignTask = async (task: CaseTask, assigneeId: number | null) => {
    if (taskBusyId !== null) return;
    setTaskBusyId(task.id);
    try {
      await apiClient.patch(`/cases/${caseId}/tasks/${task.id}`, { assignee_id: assigneeId });
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task could not be assigned.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const setTaskDueDate = async (task: CaseTask, dueDate: string | null) => {
    if (taskBusyId !== null) return;
    setTaskBusyId(task.id);
    try {
      await apiClient.patch(`/cases/${caseId}/tasks/${task.id}`, { due_date: dueDate });
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task due date could not be updated.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const removeTask = async (taskId: number) => {
    if (taskBusyId !== null) return;
    setTaskBusyId(taskId);
    try {
      await apiClient.delete(`/cases/${caseId}/tasks/${taskId}`);
      toast('Task removed from the checklist.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task could not be removed.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const seedTasksFromPlan = async (planId: number) => {
    if (seedingPlanId !== null) return;
    setSeedingPlanId(planId);
    try {
      const res = await apiClient.post(`/cases/${caseId}/tasks/from-plan/${planId}`);
      const created = Array.isArray(res.data?.created) ? res.data.created.length : 0;
      toast(
        created > 0
          ? `${created} task${created === 1 ? '' : 's'} added to the checklist.`
          : 'Every plan action is already on the checklist.',
        'success',
      );
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The checklist could not be seeded.'), 'error'); }
    finally { setSeedingPlanId(null); }
  };

  const exportTimeline = async () => {
    if (exportingTimeline) return;
    setExportingTimeline(true);
    try {
      const res = await apiClient.get(`/cases/${caseId}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `case-${caseId}-timeline.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast(getApiErrorMessage(err, 'The timeline could not be exported.'), 'error'); }
    finally { setExportingTimeline(false); }
  };

  const deleteCase = async () => {
    if (deletingCase || !caseData) return;
    setDeletingCase(true);
    try {
      await apiClient.delete(`/cases/${caseData.id}`);
      toast(`Case #${caseData.id} deleted.`, 'success');
      navigate('/cases');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The case could not be deleted.'), 'error');
      setDeletingCase(false);
      setConfirmingDelete(false);
    }
  };

  const startNoteEdit = (entry: TimelineEntry) => {
    setEditingNoteId(entry.id);
    setEditNoteText(entry.content);
  };

  const saveNoteEdit = async () => {
    const content = editNoteText.trim();
    if (!content || editingNoteId === null || savingNoteEdit) return;
    setSavingNoteEdit(true);
    try {
      await apiClient.patch(`/cases/${caseId}/notes/${editingNoteId}`, { content });
      setEditingNoteId(null);
      toast('Note updated.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The note could not be updated.'), 'error'); }
    finally { setSavingNoteEdit(false); }
  };

  const deleteNote = async (entry: TimelineEntry) => {
    if (deletingNote) return;
    setDeletingNote(true);
    try {
      await apiClient.delete(`/cases/${caseId}/notes/${entry.id}`);
      setPendingDeleteNote(null);
      toast('Note deleted.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The note could not be deleted.'), 'error'); }
    finally { setDeletingNote(false); }
  };

  const refreshWatchers = async () => {
    try {
      const res = await apiClient.get(`/cases/${caseId}/watchers`);
      setWatchers(Array.isArray(res.data) ? res.data : []);
    } catch { setWatchers([]); }
  };

  const toggleWatch = async () => {
    if (watchBusy) return;
    setWatchBusy(true);
    try {
      if (isWatching) await apiClient.delete(`/cases/${caseId}/watch`);
      else await apiClient.post(`/cases/${caseId}/watch`);
      await refreshWatchers();
    } catch (err) { toast(getApiErrorMessage(err, 'Could not update your watch.'), 'error'); }
    finally { setWatchBusy(false); }
  };

  const addWatcher = async (value: string) => {
    if (!value) return;
    try {
      const res = await apiClient.post(`/cases/${caseId}/watchers`, { user_id: Number(value) });
      setWatchers(Array.isArray(res.data) ? res.data : []);
      toast('Watcher added.', 'success');
    } catch (err) { toast(getApiErrorMessage(err, 'Could not add the watcher.'), 'error'); }
  };

  const removeWatcher = async (userId: number) => {
    try {
      await apiClient.delete(`/cases/${caseId}/watchers/${userId}`);
      setWatchers(prev => prev.filter(w => w.user_id !== userId));
    } catch (err) { toast(getApiErrorMessage(err, 'Could not remove the watcher.'), 'error'); }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [caseResult, alertsResult, eventsResult, blastResult, similarResult, plansResult, watchersResult, tasksResult] = await Promise.allSettled([
      apiClient.get(`/cases/${caseId}`), apiClient.get(`/cases/${caseId}/alerts`), apiClient.get(`/cases/${caseId}/events`),
      apiClient.get(`/cases/${caseId}/blast-radius`), apiClient.get(`/cases/${caseId}/similar`),
      apiClient.get('/response-plans/', { params: { case_id: caseId } }),
      apiClient.get(`/cases/${caseId}/watchers`),
      apiClient.get(`/cases/${caseId}/tasks`),
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
    if (plansResult.status === 'fulfilled') setPlans(plansResult.value.data?.data ?? []);
    else { setPlans([]); partial.push('Response plans unavailable'); }
    if (watchersResult.status === 'fulfilled') setWatchers(Array.isArray(watchersResult.value.data) ? watchersResult.value.data : []);
    else setWatchers([]);
    if (tasksResult.status === 'fulfilled') setTasks(Array.isArray(tasksResult.value.data) ? tasksResult.value.data : []);
    else setTasks([]);
    setDegraded(partial);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const isOwner = caseData === null || currentUserId === null || caseData.user_id === currentUserId;
  const isWatching = currentUserId !== null && watchers.some(w => w.user_id === currentUserId);
  const watchCandidates = members.filter(m => !watchers.some(w => w.user_id === m.id));

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
              {isOwner && (
                <select
                  aria-label="Change case severity"
                  value={caseData.severity}
                  disabled={changingSeverity}
                  onChange={e => void changeSeverity(e.target.value)}
                  className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200 disabled:opacity-40"
                >
                  {['info', 'low', 'medium', 'high', 'critical'].map(sev => <option key={sev} value={sev}>{sev}</option>)}
                </select>
              )}
              {isOwner && members.length > 0 && (
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
              {isOwner && (
                <label className="flex items-center gap-1.5 text-xs text-surface-400">
                  Due
                  <input
                    type="date"
                    aria-label="Case due date"
                    value={caseData.due_date ?? ''}
                    disabled={savingDueDate}
                    onChange={e => void changeDueDate(e.target.value)}
                    className="min-h-9 rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200 disabled:opacity-40"
                  />
                </label>
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
                aria-label={isWatching ? 'Stop watching this case' : 'Watch this case'}
                aria-pressed={isWatching}
                disabled={watchBusy}
                onClick={() => void toggleWatch()}
                className={`grid h-9 w-9 place-items-center rounded-md hover:bg-surface-800 disabled:opacity-40 ${isWatching ? 'text-accent-400' : 'text-surface-400 hover:text-surface-50'}`}
              >
                {isWatching
                  ? <EyeOff className="w-4 h-4" aria-hidden="true" />
                  : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
              {isOwner && (
                <button
                  type="button"
                  aria-label="Edit case details"
                  onClick={() => setShowEdit(true)}
                  className="grid h-9 w-9 place-items-center rounded-md text-surface-400 hover:bg-surface-800 hover:text-surface-50"
                >
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              {isOwner && (
                <button
                  type="button"
                  aria-label="Delete case"
                  onClick={() => setConfirmingDelete(true)}
                  className="grid h-9 w-9 place-items-center rounded-md text-surface-400 hover:bg-surface-800 hover:text-danger"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
            {caseData.summary && <p className="text-surface-400 mt-2">{caseData.summary}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-surface-400">
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Watchers</span>
              {watchers.length === 0 && <span className="text-surface-500">None yet</span>}
              {watchers.map(w => (
                <span key={w.user_id} className="inline-flex items-center gap-1 rounded-full border border-surface-700 bg-surface-900 px-2 py-0.5 text-surface-200">
                  {w.full_name || w.email}
                  {(isOwner || w.user_id === currentUserId) && (
                    <button
                      type="button"
                      aria-label={`Remove watcher ${w.email}`}
                      onClick={() => void removeWatcher(w.user_id)}
                      className="text-surface-500 hover:text-danger"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
              {isOwner && watchCandidates.length > 0 && (
                <select
                  aria-label="Add a watcher"
                  value=""
                  onChange={e => void addWatcher(e.target.value)}
                  className="min-h-7 rounded-md border border-surface-600 bg-surface-950 px-1.5 text-xs text-surface-200"
                >
                  <option value="">Add watcher...</option>
                  {watchCandidates.map(m => (
                    <option key={m.id} value={m.id}>{m.full_name ? `${m.full_name} (${m.email})` : m.email}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {(NEXT_STATUSES[caseData.status] ?? []).length > 0 && (
            <div className="flex shrink-0 gap-2" aria-label="Case status actions">
              {(NEXT_STATUSES[caseData.status] ?? []).map(action => (
                <button
                  key={action.status}
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => {
                    if (DONE_CASE_STATUSES.includes(action.status)) setPendingClose(action);
                    else void changeStatus(action.status);
                  }}
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

      {/* Close-out */}
      {DONE_CASE_STATUSES.includes(caseData.status) && (
        <div className="oa-panel p-6" data-testid="case-closeout">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50">
              <CheckCircle2 className="w-5 h-5 text-success" /> Close-out
            </h2>
            {isOwner && !editingResolution && (
              <button
                type="button"
                onClick={() => { setResolutionDraft(caseData.resolution ?? ''); setEditingResolution(true); }}
                className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300"
              >
                <Pencil className="w-3 h-3" /> {caseData.resolution ? 'Edit resolution' : 'Add resolution'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-surface-400">
            {caseData.closed_at && (
              <span>Closed {new Date(caseData.closed_at).toLocaleDateString()}</span>
            )}
            {caseData.closed_at && (
              <span>
                Took {Math.max(0, Math.round((new Date(caseData.closed_at).getTime() - new Date(caseData.created_at).getTime()) / 86400000))} days
              </span>
            )}
            {caseData.due_date && caseData.closed_at && (
              (caseData.closed_at.slice(0, 10) <= caseData.due_date)
                ? <span className="text-success">SLA met</span>
                : <span className="text-danger">SLA breached</span>
            )}
            {tasks.length > 0 && (
              <span>{tasks.filter(t => t.done).length} of {tasks.length} tasks done</span>
            )}
          </div>
          {editingResolution ? (
            <div className="mt-3 space-y-2">
              <textarea
                aria-label="Resolution summary"
                value={resolutionDraft}
                onChange={e => setResolutionDraft(e.target.value)}
                rows={3}
                placeholder="What was the outcome? Root cause, containment, follow-ups."
                className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 placeholder-surface-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={savingResolution}
                  onClick={() => void saveResolution()}
                  className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-500 disabled:opacity-40"
                >
                  Save resolution
                </button>
                <button
                  type="button"
                  disabled={savingResolution}
                  onClick={() => setEditingResolution(false)}
                  className="rounded-md border border-surface-700 px-3 py-1.5 text-xs text-surface-300 hover:bg-surface-800 disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className={`mt-3 text-sm ${caseData.resolution ? 'text-surface-200' : 'text-surface-500'}`}>
              {caseData.resolution ?? 'No resolution recorded.'}
            </p>
          )}
        </div>
      )}

      {/* Investigation Tasks */}
      <div className="oa-panel p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50">
            <ListChecks className="w-5 h-5 text-primary-400" /> Investigation Tasks
          </h2>
          {tasks.length > 0 && (
            <span className="text-xs text-surface-400">{tasks.filter(t => t.done).length} of {tasks.length} done</span>
          )}
        </div>
        {tasks.length > 0 && (
          <div
            className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-800"
            role="progressbar"
            aria-label="Task progress"
            aria-valuenow={tasks.filter(t => t.done).length}
            aria-valuemax={tasks.length}
          >
            <div
              className="h-1.5 rounded-full bg-primary-500 transition-all"
              style={{ width: `${Math.round((tasks.filter(t => t.done).length / tasks.length) * 100)}%` }}
            />
          </div>
        )}
        {tasks.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {tasks.map(task => (
              <li key={task.id} className="flex items-center gap-2 rounded-md border border-surface-800 bg-surface-900/60 px-3 py-2">
                <button
                  type="button"
                  aria-label={task.done ? `Reopen task ${task.title}` : `Complete task ${task.title}`}
                  disabled={taskBusyId === task.id}
                  onClick={() => void toggleTask(task)}
                  className="shrink-0 text-primary-400 transition-colors hover:text-primary-300 disabled:opacity-40"
                >
                  {task.done
                    ? <CheckSquare className="w-4.5 h-4.5" aria-hidden="true" />
                    : <Square className="w-4.5 h-4.5" aria-hidden="true" />}
                </button>
                <span className={`flex-1 text-sm ${task.done ? 'text-surface-500 line-through' : 'text-surface-100'}`}>
                  {task.title}
                </span>
                {task.due_date && !task.done && (
                  task.due_date < (todayStr ?? '')
                    ? <span className="shrink-0 rounded-full bg-danger/20 px-2 py-0.5 text-[10px] font-medium text-danger">Overdue · due {task.due_date}</span>
                    : <span className="shrink-0 rounded-full bg-surface-800 px-2 py-0.5 text-[10px] text-surface-300">due {task.due_date}</span>
                )}
                {members.length > 0 && (
                  <select
                    aria-label={`Assign task ${task.title}`}
                    value={task.assignee_id ?? ''}
                    disabled={taskBusyId === task.id}
                    onChange={e => void assignTask(task, e.target.value ? Number(e.target.value) : null)}
                    className="max-w-36 shrink-0 truncate rounded-md border border-surface-700 bg-surface-950 px-1.5 py-1 text-xs text-surface-300 focus:border-primary-500 focus:outline-none disabled:opacity-40"
                  >
                    <option value="">Unassigned</option>
                    {members.map(member => (
                      <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
                    ))}
                  </select>
                )}
                <input
                  type="date"
                  aria-label={`Due date for task ${task.title}`}
                  value={task.due_date ?? ''}
                  disabled={taskBusyId === task.id}
                  onChange={e => void setTaskDueDate(task, e.target.value || null)}
                  className="w-28 shrink-0 rounded-md border border-surface-700 bg-surface-950 px-1.5 py-1 text-xs text-surface-300 focus:border-primary-500 focus:outline-none disabled:opacity-40 [color-scheme:dark]"
                />
                <button
                  type="button"
                  aria-label={`Delete task ${task.title}`}
                  disabled={taskBusyId === task.id}
                  onClick={() => void removeTask(task.id)}
                  className="shrink-0 text-surface-500 transition-colors hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {tasks.length === 0 && (
          <p className="mb-3 text-sm text-surface-500">No tasks yet. Break the investigation into steps to track progress.</p>
        )}
        <form
          onSubmit={e => { e.preventDefault(); void addTask(); }}
          className="flex gap-2"
        >
          <input
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            placeholder="Add an investigation task..."
            aria-label="New task title"
            maxLength={300}
            className="min-h-9 flex-1 rounded-md border border-surface-700 bg-surface-950 px-3 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newTaskTitle.trim() || addingTask}
            className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add task
          </button>
        </form>
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

      {/* Response Plans */}
      {plans.length > 0 && (
        <div className="oa-panel p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50 mb-3">
            <Shield className="w-5 h-5 text-primary-400" /> Response Plans
          </h2>
          <div className="space-y-2">
            {plans.map(plan => (
              <div key={plan.id} className="flex items-stretch gap-2">
                <Link
                  to="/response-plans"
                  className="flex flex-1 items-center justify-between gap-3 rounded-md border border-surface-700 bg-surface-800/50 p-3 transition-colors hover:border-primary-500/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-sm font-medium text-surface-100">Plan #{plan.id}</span>
                    <StatusBadge tone={plan.status === 'approved' || plan.status === 'completed' ? 'success' : plan.status === 'rejected' ? 'danger' : plan.status === 'pending_approval' ? 'warning' : plan.status === 'executing' ? 'info' : 'neutral'}>{plan.status.replace('_', ' ')}</StatusBadge>
                    <span className="text-xs text-surface-500">{plan.actions?.length ?? 0} actions · {plan.autonomy_level} · {plan.created_by}</span>
                  </div>
                  <span className="shrink-0 text-xs text-surface-500">{new Date(plan.created_at).toLocaleDateString()}</span>
                </Link>
                {(plan.actions?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    aria-label={`Seed checklist from plan ${plan.id}`}
                    disabled={seedingPlanId === plan.id}
                    onClick={() => void seedTasksFromPlan(plan.id)}
                    className="shrink-0 rounded-md border border-surface-700 px-3 text-xs font-medium text-surface-200 transition-colors hover:bg-surface-800 disabled:opacity-40"
                  >
                    Add to checklist
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout: Timeline + Related Items */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2">
          <div className="oa-panel p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-surface-50">Investigation Timeline</h2>
              <button
                type="button"
                onClick={() => { void exportTimeline(); }}
                disabled={exportingTimeline}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                {exportingTimeline ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>
            <form className="mb-4 flex items-start gap-2" onSubmit={e => { e.preventDefault(); void addNote(); }}>
              <label htmlFor="case-note" className="sr-only">Add a timeline note</label>
              <MentionTextarea
                id="case-note"
                rows={2}
                value={noteText}
                members={members}
                onChange={setNoteText}
                placeholder="Add an investigation note… (@ to mention a teammate)"
                className="min-h-9 w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
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
                    <div
                      key={entry.id}
                      id={`case-note-${entry.id}`}
                      className={highlightedNoteId === entry.id
                        ? 'flex gap-4 rounded-md bg-primary-500/10 ring-2 ring-primary-500'
                        : 'flex gap-4'}
                    >
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
                          <span className="text-xs text-surface-600">{entry.author_email ?? entry.source}</span>
                          {entry.metadata_json?.edited ? <span className="text-xs text-surface-600">(edited)</span> : null}
                          {isOwner && entry.entry_type === 'note' && editingNoteId !== entry.id && (
                            <span className="ml-auto flex items-center gap-2">
                              <button
                                type="button"
                                aria-label="Edit note"
                                onClick={() => startNoteEdit(entry)}
                                className="text-surface-500 hover:text-primary-400"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete note"
                                onClick={() => setPendingDeleteNote(entry)}
                                className="text-surface-500 hover:text-danger"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </span>
                          )}
                        </div>
                        {editingNoteId === entry.id ? (
                          <div className="flex items-start gap-2">
                            <label htmlFor={`edit-note-${entry.id}`} className="sr-only">Edit note</label>
                            <textarea
                              id={`edit-note-${entry.id}`}
                              rows={2}
                              value={editNoteText}
                              onChange={e => setEditNoteText(e.target.value)}
                              className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100"
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={savingNoteEdit || !editNoteText.trim()}
                                onClick={() => void saveNoteEdit()}
                                className="min-h-8 rounded-md bg-primary-500 px-2.5 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
                              >
                                {savingNoteEdit ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingNoteId(null)}
                                className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-surface-300 hover:bg-surface-800"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-surface-300 text-sm">{entry.content}</p>
                        )}
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
              {isOwner && (
                <button type="button" onClick={() => void openLinkAlert()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800">
                  <Link2 className="w-3.5 h-3.5" /> Link alert
                </button>
              )}
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
                      {isOwner && (
                        <button
                          type="button"
                          aria-label={`Unlink alert ${a.title}`}
                          disabled={unlinkingId !== null}
                          onClick={() => void unlinkItem('alerts', a.id)}
                          className="ml-auto text-surface-500 hover:text-danger disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
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
              {isOwner && (
                <button type="button" onClick={() => void openLinkEvent()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800">
                  <Link2 className="w-3.5 h-3.5" /> Link event
                </button>
              )}
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
                      {isOwner && (
                        <button
                          type="button"
                          aria-label={`Unlink event ${e.signature ?? e.event_type}`}
                          disabled={unlinkingId !== null}
                          onClick={() => void unlinkItem('events', e.id)}
                          className="ml-auto text-surface-500 hover:text-danger disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
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

      {pendingClose && (
        <ConfirmDialog
          title={`${pendingClose.label} this case?`}
          description="The case moves to a done state. You can reopen it later from the case page."
          confirmLabel={pendingClose.label}
          reasonLabel={isOwner ? 'Resolution summary (optional)' : undefined}
          reasonPlaceholder="Root cause, containment, follow-ups."
          defaultReason={caseData.resolution ?? ''}
          busy={updatingStatus}
          onCancel={() => { if (!updatingStatus) setPendingClose(null); }}
          onConfirm={(reason) => { setPendingClose(null); void changeStatus(pendingClose.status, reason); }}
        />
      )}

      {pendingDeleteNote && (
        <ConfirmDialog
          title="Delete note?"
          description="This timeline note will be permanently removed from the investigation. This cannot be undone."
          confirmLabel="Delete note"
          tone="danger"
          busy={deletingNote}
          onCancel={() => { if (!deletingNote) setPendingDeleteNote(null); }}
          onConfirm={() => { void deleteNote(pendingDeleteNote); }}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete case"
          description={`Delete case #${caseData.id} "${caseData.title}"? Its timeline, notes, linked alerts and events, and response plans are removed and cannot be restored.`}
          confirmLabel="Delete case"
          tone="danger"
          busy={deletingCase}
          onCancel={() => { if (!deletingCase) setConfirmingDelete(false); }}
          onConfirm={() => void deleteCase()}
        />
      )}

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
