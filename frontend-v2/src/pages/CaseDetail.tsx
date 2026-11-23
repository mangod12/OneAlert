import { CaseWatcherRemovalReview } from '../components/CaseWatcherRemovalReview';
import { CaseNoteDeletionReview } from '../components/CaseNoteDeletionReview';
import { CaseNoteEditReview } from '../components/CaseNoteEditReview';
import { CaseNoteAdditionReview } from '../components/CaseNoteAdditionReview';
import { CaseWatcherAdditionReview } from '../components/CaseWatcherAdditionReview';
import { CaseStatusReview } from '../components/CaseStatusReview';
import { CaseResolutionReview } from '../components/CaseResolutionReview';
import { CaseDetailsReview } from '../components/CaseDetailsReview';
import { CaseChangeReceipts } from '../components/CaseChangeReceipts';
import { CasePriorityReview, type PriorityField } from '../components/CasePriorityReview';
import { CaseDeletionReview } from '../components/CaseDeletionReview';
import { CaseListAssignmentReview } from '../components/CaseListAssignmentReview';
import { EvidenceNoteSourceIndex } from '../components/EvidenceNoteSourceIndex';
import { CaseEvidenceChronology } from '../components/CaseEvidenceChronology';
import { TriageCoverageReceipt } from '../components/TriageCoverageReceipt';
import { CaseEvidenceOverlap } from '../components/CaseEvidenceOverlap';
import { CaseCloseReview } from '../components/CaseCloseReview';
import { CaseEvidenceNoteDialog } from '../components/CaseEvidenceNoteDialog';
import { EvidenceNoteReference } from '../components/EvidenceNoteReference';
import { CaseEvidenceUnlinkDialog } from '../components/CaseEvidenceUnlinkDialog';
import { CaseEvidencePicker } from '../components/CaseEvidencePicker';
import { ChecklistBatchTools } from '../components/ChecklistBatchTools';
import type { ChecklistSelection } from '../components/ChecklistImportPreview';
import { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TimelineExplorer } from '../components/TimelineExplorer';
import { TaskTitleDialog } from '../components/TaskTitleDialog';
import { CaseResponsePlans } from '../components/CaseResponsePlans';
import { CaseHandoff } from '../components/CaseHandoff';
import { CaseBriefingDrafts } from '../components/CaseBriefingDrafts';
import { CaseBriefingExactReview } from '../components/CaseBriefingExactReview';
import { MentionTextarea } from '../components/MentionTextarea';
import apiClient from '../api/client';
import { ChecklistTriage } from '../components/ChecklistTriage';
import { useAuthStore } from '../stores/authStore';
import { ChecklistImportRecord } from '../components/ChecklistImportRecord';
import { ArrowLeft, Brain, AlertTriangle, Activity, Clock, Target, Network, GitBranch, Link2, X, Pencil, Trash2, Download, Eye, EyeOff, ListChecks, Square, CheckSquare, CheckCircle2 } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { toast } from '../components/Toast';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
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
interface SimilarCase { case_id: number; title: string; similarity: number; shared_techniques: string[]; ranking_method?: string; shared_terms?: string[]; }
interface RelatedEvent { id: number; severity: string; event_type: string; source_ip?: string | null; dest_ip?: string | null; signature?: string | null; }

interface CaseWatcher { user_id: number; email: string; full_name: string | null; }
interface CaseTask { id: number; title: string; done: boolean; position: number; assignee_id: number | null; due_date: string | null; created_at: string; completed_at: string | null; }

export function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const caseRequestId = useRef(0);
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [searchParams] = useSearchParams();
  const highlightedNoteId = Number(searchParams.get('note')) || null;
  const taskIds = searchParams.getAll('task');
  const linkedTaskId = taskIds.length === 1 && /^[1-9][0-9]*$/.test(taskIds[0]) && Number.isSafeInteger(Number(taskIds[0])) ? Number(taskIds[0]) : null;
  const invalidTaskLink = taskIds.length > 0 && linkedTaskId === null;

  useEffect(() => {
    if (!highlightedNoteId || !caseData) return;
    document.getElementById(`case-note-${highlightedNoteId}`)?.scrollIntoView?.({ block: 'center' });
  }, [caseData, highlightedNoteId]);
  const [alerts, setAlerts] = useState<RelatedAlert[]>([]);
  const [events, setEvents] = useState<RelatedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [degraded, setDegraded] = useState<string[]>([]);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<{ status: string; label: string } | null>(null);
  const [editingResolution, setEditingResolution] = useState(false);
  const [blastRadius, setBlastRadius] = useState<BlastRadius | null>(null);
  const [similarCases, setSimilarCases] = useState<SimilarCase[]>([]);
  const [noteText, setNoteText] = useState('');
  const [noteAddition, setNoteAddition] = useState<{ caseId: number; content: string } | null>(null);
  const addingNote = noteAddition !== null;
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [noteEditReview, setNoteEditReview] = useState<{ caseId: number; noteId: number; content: string } | null>(null);
  const savingNoteEdit = noteEditReview !== null;
  const [pendingDeleteNote, setPendingDeleteNote] = useState<TimelineEntry | null>(null);
  const [exportingTimeline, setExportingTimeline] = useState(false);
  const [showLinkAlert, setShowLinkAlert] = useState(false);
  const [showLinkEvent, setShowLinkEvent] = useState(false);
  const [noteTarget, setNoteTarget] = useState<{ kind: 'alert' | 'event'; id: number } | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<{ kind: 'alert' | 'event'; id: number } | null>(null);
  const [priorityReview, setPriorityReview] = useState<{ caseId: number; field: PriorityField; value: string } | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const navigate = useNavigate();
  const [members, setMembers] = useState<Array<{ id: number; email: string; full_name: string | null; is_active: boolean }>>([]);
  const [assignmentReview, setAssignmentReview] = useState<{ caseId: number; targetId: number | null } | null>(null);
  const [watcherAddition, setWatcherAddition] = useState<{ caseId: number; userId: number } | null>(null);
  useEffect(() => { setAssignmentReview(null); setConfirmingDelete(false); setPriorityReview(null); setWatcherAddition(null); setNoteAddition(null); setNoteEditReview(null); setPendingDeleteNote(null); }, [caseId]);
  const [watcherRemoval, setWatcherRemoval] = useState<{ caseId: number; userId: number } | null>(null);
  useEffect(() => { setWatcherRemoval(null); }, [caseId]);
  const [watchers, setWatchers] = useState<CaseWatcher[]>([]);
  const [watchBusy, setWatchBusy] = useState(false);
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [batchBusyCaseId, setBatchBusyCaseId] = useState<number | null>(null);
  const batchTaskBusy = batchBusyCaseId === Number(caseId);
  const [tasksUnavailable, setTasksUnavailable] = useState(false);
  const [editingTask, setEditingTask] = useState<CaseTask | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<number | null>(null);
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => {
    const refreshLocalDate = () => { const now = new Date(); setTodayStr(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`); };
    refreshLocalDate();
    const timer = window.setInterval(refreshLocalDate, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [seedingPlanId, setSeedingPlanId] = useState<number | null>(null);
  const currentUserId = useAuthStore(state => state.user?.id ?? null);
  const canManageChecklist = currentUserId !== null && caseData !== null && (caseData.user_id === currentUserId || caseData.assigned_to_id === currentUserId);
  const canEditAssignedTask = (task: CaseTask) => canManageChecklist || (currentUserId !== null && task.assignee_id === currentUserId);

  useEffect(() => {
    apiClient.get('/orgs/me/members')
      .then(res => setMembers((res.data as Array<{ id: number; email: string; full_name: string | null; is_active: boolean }>).filter(m => m.is_active)))
      .catch(() => setMembers([]));
  }, []);

  const changeAssignee = (value: string) => {
    const targetId = value === '' ? null : Number(value);
    if (!caseData || targetId === caseData.assigned_to_id || assignmentReview) return;
    setAssignmentReview({ caseId: caseData.id, targetId });
  };

  const reviewPriority = (field: PriorityField, value: string) => {
    if (!caseData || priorityReview || (field === 'severity' ? caseData.severity : caseData.due_date ?? '') === value) return;
    setPriorityReview({ caseId: caseData.id, field, value });
  };

  const addNote = () => {
    const content = noteText.trim();
    if (!content || addingNote || noteAddition || !caseData) return;
    setNoteAddition({ caseId: caseData.id, content });
  };

  const addTask = async () => {
    const title = newTaskTitle.trim();
    if (!canManageChecklist || !title || addingTask || tasksUnavailable || batchTaskBusy) return;
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
    if (!canEditAssignedTask(task) || taskBusyId !== null || batchTaskBusy) return;
    setTaskBusyId(task.id);
    try {
      await apiClient.patch(`/cases/${caseId}/tasks/${task.id}`, { done: !task.done });
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task could not be updated.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const assignTask = async (task: CaseTask, assigneeId: number | null) => {
    if (!canManageChecklist || taskBusyId !== null || batchTaskBusy) return;
    setTaskBusyId(task.id);
    try {
      await apiClient.patch(`/cases/${caseId}/tasks/${task.id}`, { assignee_id: assigneeId });
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task could not be assigned.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const setTaskDueDate = async (task: CaseTask, dueDate: string | null) => {
    if (!canEditAssignedTask(task) || taskBusyId !== null || batchTaskBusy) return;
    setTaskBusyId(task.id);
    try {
      await apiClient.patch(`/cases/${caseId}/tasks/${task.id}`, { due_date: dueDate });
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task due date could not be updated.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const removeTask = async (taskId: number) => {
    if (!canManageChecklist || taskBusyId !== null || batchTaskBusy) return;
    setTaskBusyId(taskId);
    try {
      await apiClient.delete(`/cases/${caseId}/tasks/${taskId}`);
      toast('Task removed from the checklist.', 'success');
      await fetchAll();
    } catch (err) { toast(getApiErrorMessage(err, 'The task could not be removed.'), 'error'); }
    finally { setTaskBusyId(null); }
  };

  const seedTasksFromPlan = async (planId: number, payload: ChecklistSelection) => {
    if (!canManageChecklist || seedingPlanId !== null || tasksUnavailable || batchTaskBusy) return false;
    setSeedingPlanId(planId);
    try {
      const res = await apiClient.post(`/cases/${caseId}/tasks/from-plan/${planId}`, payload);
      const created = Array.isArray(res.data?.created) ? res.data.created.length : 0;
      toast(
        created > 0
          ? `${created} task${created === 1 ? '' : 's'} added to the checklist.`
          : 'Every plan action is already on the checklist.',
        'success',
      );
      await fetchAll();
      return true;
    } catch (err) { toast(getApiErrorMessage(err, 'The checklist could not be seeded.'), 'error'); return false; }
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

  const startNoteEdit = (entry: TimelineEntry) => {
    setEditingNoteId(entry.id);
    setEditNoteText(entry.content);
  };

  const saveNoteEdit = () => {
    const content = editNoteText.trim();
    if (!content || editingNoteId === null || savingNoteEdit || !caseData) return;
    setNoteEditReview({ caseId: caseData.id, noteId: editingNoteId, content });
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

  const fetchAll = useCallback(async () => {
    const request = ++caseRequestId.current;
    setLoading(true);
    const [caseResult, alertsResult, eventsResult, blastResult, similarResult, watchersResult, tasksResult] = await Promise.allSettled([
      apiClient.get(`/cases/${caseId}`), apiClient.get(`/cases/${caseId}/alerts`), apiClient.get(`/cases/${caseId}/events`),
      apiClient.get(`/cases/${caseId}/blast-radius`), apiClient.get(`/cases/${caseId}/similar`),
      apiClient.get(`/cases/${caseId}/watchers`),
      apiClient.get(`/cases/${caseId}/tasks`),
    ]);
    if (request !== caseRequestId.current) return;
    if (caseResult.status === 'fulfilled' && caseResult.value.data?.id !== Number(caseId)) { setCaseData(null); setError('The investigation response did not match the requested record. Retry to load it.'); setLoading(false); return; }
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
    if (watchersResult.status === 'fulfilled') setWatchers(Array.isArray(watchersResult.value.data) ? watchersResult.value.data : []);
    else setWatchers([]);
    if (tasksResult.status === 'fulfilled' && Array.isArray(tasksResult.value.data)) {
      setTasks(tasksResult.value.data);
      setTasksUnavailable(false);
    } else {
      setTasks([]);
      setTasksUnavailable(true);
      partial.push('Investigation tasks unavailable');
    }
    setDegraded(partial);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { setShowLinkAlert(false); setShowLinkEvent(false); setUnlinkTarget(null); setNoteTarget(null); }, [caseId]);

  useEffect(() => { void fetchAll(); return () => { caseRequestId.current += 1; }; }, [fetchAll]);

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
        <div className="flex flex-col items-start justify-between gap-3 xl:flex-row">
          <div className="min-w-0 max-w-full">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <StatusBadge tone={alertSeverityTones[caseData.severity] ?? 'neutral'}>{caseData.severity}</StatusBadge>
              <StatusBadge tone={caseStatusTones[caseData.status] ?? 'neutral'}>{caseData.status}</StatusBadge>
              {isOwner && (
                <select
                  aria-label="Change case severity"
                  value={caseData.severity}
                  disabled={priorityReview !== null}
                  onChange={e => reviewPriority('severity', e.target.value)}
                  className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200 disabled:opacity-40"
                >
                  {['info', 'low', 'medium', 'high', 'critical'].map(sev => <option key={sev} value={sev}>{sev}</option>)}
                </select>
              )}
              {isOwner && members.length > 0 && (
                <select
                  aria-label="Assign case"
                  value={caseData.assigned_to_id ?? ''}
                  disabled={assignmentReview !== null}
                  onChange={e => void changeAssignee(e.target.value)}
                  className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200 disabled:opacity-40"
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
                    disabled={priorityReview !== null}
                    onChange={e => reviewPriority('due_date', e.target.value)}
                    className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200 disabled:opacity-40"
                  />
                </label>
              )}
              {caseData.confidence_score && (
                <span className="text-sm text-surface-400">
                  {Math.round(caseData.confidence_score * 100)}% confidence
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 max-w-full break-words text-2xl font-bold text-surface-50">{caseData.title}</h1>
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
            <div className="mt-3 flex flex-wrap items-center gap-3"><CaseHandoff key={caseData.id} caseId={caseData.id} /><Link to={`/hunt?source_case=${caseData.id}`} className="text-xs text-primary-300 underline">Prepare a hunt hypothesis from this investigation</Link></div>
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
                      onClick={() => setWatcherRemoval({ caseId: caseData.id, userId: w.user_id })}
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
                  onChange={e => { if (e.target.value) setWatcherAddition({ caseId: caseData.id, userId: Number(e.target.value) }); }}
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
            <div className="flex shrink-0 flex-wrap gap-2" aria-label="Case status actions">
              {(NEXT_STATUSES[caseData.status] ?? []).map(action => (
                <button
                  key={action.status}
                  type="button"
                  disabled={!!pendingStatus || !!pendingClose}
                  onClick={() => {
                    if (DONE_CASE_STATUSES.includes(action.status)) setPendingClose(action);
                    else setPendingStatus(action.status);
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-surface-50">
              <CheckCircle2 className="w-5 h-5 text-success" /> Close-out
            </h2>
            {isOwner && !editingResolution && (
              <button
                type="button"
                onClick={() => setEditingResolution(true)}
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
          <p className={`mt-3 text-sm ${caseData.resolution ? 'text-surface-200' : 'text-surface-500'}`}>
            {caseData.resolution ?? 'No resolution recorded.'}
          </p>
        </div>
      )}

      {/* Investigation Tasks */}
      <div className="oa-panel p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
        {!canManageChecklist && <p className="mb-3 text-xs text-warning">Only the investigation owner or assignee can add, rename, reassign, delete or import checklist tasks. You can change completion and due dates only for tasks currently assigned to you. Other checklist records are read-only.</p>}
        {invalidTaskLink && <p role="alert" className="mb-3 text-sm text-warning">The task link has an invalid task ID. No task was selected or changed.</p>}
        {!tasksUnavailable && tasks.length === 0 && linkedTaskId !== null && <p role="alert" className="mb-3 text-sm text-warning">Task #{linkedTaskId} is not in this loaded investigation checklist. No task was changed.</p>}
        {tasks.length > 0 && (
          <ChecklistBatchTools readOnly={!canManageChecklist} key={caseData.id} caseId={caseData.id} tasks={tasks} members={members} externalBusy={batchTaskBusy || taskBusyId !== null || addingTask || seedingPlanId !== null} onRefresh={() => void fetchAll()} onBusyChange={busy => setBatchBusyCaseId(current => busy ? caseData.id : current === caseData.id ? null : current)} onSaved={saved => setTasks(current => current.map(task => ({ ...task, ...saved.find(row => row.id === task.id) })))}>
          {selection => <ChecklistTriage onSelectMatching={selection.select} selectionBusy={selection.busy || taskBusyId !== null} key={`${caseData.id}:${linkedTaskId ?? ''}`} tasks={tasks} today={todayStr ?? ''} currentUserId={currentUserId} members={members} linkedTaskId={linkedTaskId}>
            {task => (
              <li key={task.id} id={`case-task-${task.id}`} tabIndex={-1} className={`flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-surface-800 bg-surface-900/60 px-3 py-2 focus:outline-none ${linkedTaskId === task.id ? 'ring-2 ring-primary-400' : ''}`}>
                <label className="flex shrink-0 items-center gap-1 text-[10px] text-surface-400"><input type="checkbox" aria-label={`Select checklist task #${task.id}: ${task.title}`} checked={selection.selected.has(task.id)} disabled={batchTaskBusy || selection.busy || taskBusyId !== null || (!selection.selected.has(task.id) && selection.selected.size >= 100)} onChange={() => selection.toggle(task.id)} />Select</label>
                <button
                  type="button"
                  aria-label={task.done ? `Reopen task ${task.title}` : `Complete task ${task.title}`}
                  disabled={!canEditAssignedTask(task) || batchTaskBusy || taskBusyId !== null}
                  onClick={() => void toggleTask(task)}
                  className="shrink-0 text-primary-400 transition-colors hover:text-primary-300 disabled:opacity-40"
                >
                  {task.done
                    ? <CheckSquare className="w-4.5 h-4.5" aria-hidden="true" />
                    : <Square className="w-4.5 h-4.5" aria-hidden="true" />}
                </button>
                <span className={`min-w-0 flex-1 break-words text-sm ${task.done ? 'text-surface-500 line-through' : 'text-surface-100'}`}>
                  {task.title}
                </span>
                <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
                  {task.due_date && !task.done && (
                    task.due_date < (todayStr ?? '')
                      ? <span className="shrink-0 rounded-full bg-danger/20 px-2 py-0.5 text-[10px] font-medium text-danger">Overdue · due {task.due_date}</span>
                      : <span className="shrink-0 rounded-full bg-surface-800 px-2 py-0.5 text-[10px] text-surface-300">due {task.due_date}</span>
                  )}
                  {members.length > 0 && (
                    <select
                      aria-label={`Assign task ${task.title}`}
                      value={task.assignee_id ?? ''}
                      disabled={!canManageChecklist || batchTaskBusy || taskBusyId !== null}
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
                    disabled={!canEditAssignedTask(task) || batchTaskBusy || taskBusyId !== null}
                    onChange={e => void setTaskDueDate(task, e.target.value || null)}
                    className="w-28 shrink-0 rounded-md border border-surface-700 bg-surface-950 px-1.5 py-1 text-xs text-surface-300 focus:border-primary-500 focus:outline-none disabled:opacity-40 [color-scheme:dark]"
                  />
                  <button type="button" aria-label={`Edit task ${task.title}`} disabled={!canManageChecklist || batchTaskBusy || taskBusyId !== null}
                    onClick={() => setEditingTask(task)} className="shrink-0 text-surface-400 hover:text-primary-300 disabled:opacity-40">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete task ${task.title}`}
                    disabled={!canManageChecklist || batchTaskBusy || taskBusyId !== null}
                    onClick={() => void removeTask(task.id)}
                    className="shrink-0 text-surface-500 transition-colors hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            )}
          </ChecklistTriage>}
          </ChecklistBatchTools>
        )}
        {tasksUnavailable && (
          <div role="alert" className="mb-3 text-sm text-danger">Checklist could not be loaded. Task counts and completion status are unknown. <button type="button" onClick={() => void fetchAll()} className="underline">Retry checklist</button></div>
        )}
        {!tasksUnavailable && tasks.length === 0 && (
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
            disabled={!canManageChecklist || tasksUnavailable || batchTaskBusy}
            maxLength={300}
            className="min-h-9 min-w-0 flex-1 rounded-md border border-surface-700 bg-surface-950 px-3 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canManageChecklist || tasksUnavailable || batchTaskBusy || !newTaskTitle.trim() || addingTask}
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
          {caseData.created_by === 'agent' && <p className="mt-3 text-xs text-warning">Check saved input coverage in the investigation timeline before relying on generated analysis. Linked records may exceed the inputs sent to AI.</p>}
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
          <p className="mb-3 text-xs text-surface-400">Lexical similarity of saved title, summary, narrative, ATT&amp;CK labels and severity. The percentage is a text-ranking score, not a probability, confirmed relationship or incident match. Only your owned investigations are searched. Shared ATT&amp;CK IDs are recorded evidence, not proof of the same activity.</p>
          <div className="space-y-2">
            {similarCases.map(similar => (
              <Link
                key={similar.case_id}
                to={`/cases/${similar.case_id}`}
                className="block rounded-md border border-surface-700 bg-surface-800/50 p-3 transition-colors hover:border-primary-500/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-medium text-surface-100 [overflow-wrap:anywhere]">{similar.title}</span>
                  <span className="shrink-0 text-xs text-primary-300">{Math.round(similar.similarity * 100)}% similar</span>
                </div>
                {similar.ranking_method === 'lexical_tfidf_cosine' && Array.isArray(similar.shared_terms) && similar.shared_terms.length > 0 && <p className="mt-2 break-words text-xs text-surface-300 [overflow-wrap:anywhere]">Top shared ranking terms: {similar.shared_terms.join(', ')}</p>}
                {similar.shared_techniques.length > 0 && (
                  <p className="mt-1 text-xs text-surface-500">Shared techniques: {similar.shared_techniques.join(', ')}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {isOwner && <CaseChangeReceipts key={`receipts-${caseData.id}`} caseId={caseData.id} ownerId={caseData.user_id} />}
      <CaseEvidenceChronology key={`chronology-${caseData.id}`} caseId={caseData.id} />
      <CaseEvidenceOverlap key={`overlap-${caseData.id}`} caseId={caseData.id} />

      <CaseBriefingExactReview caseId={caseData.id} canOpen={currentUserId === null ? null : isOwner} />
      {isOwner && <CaseBriefingDrafts key={`briefings-${caseData.id}`} caseId={caseData.id} />}
      <CaseResponsePlans canDraft={currentUserId !== null && caseData.user_id === currentUserId} key={caseData.id} caseId={caseData.id} onSeed={(id, payload) => seedTasksFromPlan(id, payload)} seedBusy={!canManageChecklist || seedingPlanId !== null || batchTaskBusy} tasksUnavailable={tasksUnavailable} />

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
            <EvidenceNoteSourceIndex caseId={caseData.id} entries={caseData.timeline} onSelect={noteId => { const params = new URLSearchParams(searchParams); params.set('note', String(noteId)); navigate(`/cases/${caseId}?${params}`, { replace: true }); }} />
            <TimelineExplorer key={caseData.id} entries={caseData.timeline} pinnedIds={[highlightedNoteId, editingNoteId].filter((id): id is number => id !== null)}>
                {(entry) => {
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
                      <div className="min-w-0 flex-1 pb-4">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
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
                          <p className="break-words text-sm text-surface-300">{entry.content}</p>
                        )}
                        {entry.entry_type === 'note' && <EvidenceNoteReference metadata={entry.metadata_json} caseId={caseData.id} noteId={entry.id} canOpenOriginal={isOwner} />}
                        {entry.entry_type === 'ai_analysis' && <TriageCoverageReceipt metadata={entry.metadata_json} />}
                        {entry.entry_type === 'action' && <ChecklistImportRecord metadata={entry.metadata_json} caseId={caseData.id} />}
                      </div>
                    </div>
                  );
                }}
            </TimelineExplorer>
          </div>
        </div>

        {/* Related Alerts & Events */}
        <div className="space-y-6">
          <div className="oa-panel p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-surface-50">Related Alerts</h2><a className="text-xs text-primary-300" href={`/app/cases/${Number(caseId)}/evidence?kind=alert`}>Browse linked alert evidence</a>
              {isOwner && (
                <button type="button" onClick={() => setShowLinkAlert(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800">
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
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={alertSeverityTones[a.severity] ?? 'neutral'}>{a.severity}</StatusBadge>
                      {a.cve_id && <span className="text-xs text-primary-400">{a.cve_id}</span>}
                      {isOwner && (
                        <span className="ml-auto inline-flex items-center gap-3">
                        <button type="button" disabled={noteTarget !== null || unlinkTarget !== null} aria-label={`Note about alert ${a.title}`} onClick={() => setNoteTarget({ kind: 'alert', id: a.id })} className="min-h-9 text-xs text-primary-300 hover:underline disabled:opacity-50">Add evidence note</button>
                        <button
                          type="button"
                          aria-label={`Unlink alert ${a.title}`}
                          disabled={unlinkTarget !== null || noteTarget !== null}
                          onClick={() => setUnlinkTarget({ kind: 'alert', id: a.id })}
                          className="text-surface-500 hover:text-danger disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        </span>
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
              <h2 className="text-lg font-semibold text-surface-50">Related Events</h2><a className="text-xs text-primary-300" href={`/app/cases/${Number(caseId)}/evidence?kind=event`}>Browse linked event evidence</a>
              {isOwner && (
                <button type="button" onClick={() => setShowLinkEvent(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-surface-600 px-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800">
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
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={eventSeverityTones[e.severity] ?? 'neutral'}>{e.severity}</StatusBadge>
                      <span className="text-xs text-surface-500">{e.event_type}</span>
                      {isOwner && (
                        <span className="ml-auto inline-flex items-center gap-3">
                        <button type="button" disabled={noteTarget !== null || unlinkTarget !== null} aria-label={`Note about event ${e.signature ?? e.event_type}`} onClick={() => setNoteTarget({ kind: 'event', id: e.id })} className="min-h-9 text-xs text-primary-300 hover:underline disabled:opacity-50">Add evidence note</button>
                        <button
                          type="button"
                          aria-label={`Unlink event ${e.signature ?? e.event_type}`}
                          disabled={unlinkTarget !== null || noteTarget !== null}
                          onClick={() => setUnlinkTarget({ kind: 'event', id: e.id })}
                          className="text-surface-500 hover:text-danger disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        </span>
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

      {editingTask && <TaskTitleDialog key={editingTask.id} title={editingTask.title} onClose={() => setEditingTask(null)}
        onSave={async title => {
          if (!canManageChecklist) throw new Error('Checklist management permission is required.');
          const response = await apiClient.patch<CaseTask>(`/cases/${caseId}/tasks/${editingTask.id}`, { title });
          if (response.data.id !== editingTask.id || typeof response.data.title !== 'string') throw new Error('The saved task could not be verified. Retry to refresh it.');
          setTasks(current => current.map(task => task.id === editingTask.id ? response.data : task));
        }} />}

      {priorityReview && priorityReview.caseId === caseData.id && <CasePriorityReview key={`priority-${priorityReview.caseId}:${priorityReview.field}:${priorityReview.value}`} caseId={priorityReview.caseId} field={priorityReview.field} value={priorityReview.value} onClose={() => { setPriorityReview(null); void fetchAll(); }} onSaved={() => { setPriorityReview(null); toast('Reviewed investigation priority updated.', 'success'); void fetchAll(); }} />}
      {assignmentReview && assignmentReview.caseId === caseData.id && <CaseListAssignmentReview key={`${assignmentReview.caseId}:${assignmentReview.targetId}`} caseIds={[assignmentReview.caseId]} targetId={assignmentReview.targetId} onClose={() => { setAssignmentReview(null); void fetchAll(); }} onChanged={() => { /* Keep confirmed outcomes mounted; closing reloads the full investigation. */ }} />}
      {noteEditReview && noteEditReview.caseId === caseData.id && <CaseNoteEditReview key={`${noteEditReview.caseId}:${noteEditReview.noteId}:${noteEditReview.content}`} caseId={noteEditReview.caseId} noteId={noteEditReview.noteId} content={noteEditReview.content} onClose={() => { setNoteEditReview(null); void fetchAll(); }} onSaved={() => { setNoteEditReview(null); setEditingNoteId(null); toast('Reviewed note updated.', 'success'); void fetchAll(); }} />}
      {noteAddition && noteAddition.caseId === caseData.id && <CaseNoteAdditionReview key={`${noteAddition.caseId}:${noteAddition.content}`} caseId={noteAddition.caseId} content={noteAddition.content} onClose={() => { setNoteAddition(null); void fetchAll(); }} onSaved={() => { setNoteAddition(null); setNoteText(''); toast('Reviewed note added to the timeline.', 'success'); void fetchAll(); }} />}
      {watcherRemoval && watcherRemoval.caseId === caseData.id && <CaseWatcherRemovalReview key={`${watcherRemoval.caseId}:${watcherRemoval.userId}`} caseId={watcherRemoval.caseId} userId={watcherRemoval.userId} onClose={() => { setWatcherRemoval(null); void fetchAll(); }} onSaved={() => { setWatcherRemoval(null); toast('Reviewed watcher removed.', 'success'); void fetchAll(); }} />}
      {watcherAddition && watcherAddition.caseId === caseData.id && <CaseWatcherAdditionReview key={`${watcherAddition.caseId}:${watcherAddition.userId}`} caseId={watcherAddition.caseId} userId={watcherAddition.userId} onClose={() => { setWatcherAddition(null); void fetchAll(); }} onSaved={() => { setWatcherAddition(null); toast('Reviewed watcher added.', 'success'); void fetchAll(); }} />}

      {pendingStatus && <CaseStatusReview key={`${caseData.id}:${pendingStatus}`} caseId={caseData.id} value={pendingStatus} onClose={() => { setPendingStatus(null); void fetchAll(); }} onSaved={() => { setPendingStatus(null); toast('Reviewed investigation status updated.', 'success'); void fetchAll(); }} />}

      {pendingClose && <CaseCloseReview key={`${caseData.id}:${pendingClose.status}`} caseId={caseData.id} targetStatus={pendingClose.status} label={pendingClose.label} onClose={() => { setPendingClose(null); void fetchAll(); }} onSaved={() => { setPendingClose(null); toast(`Case marked ${pendingClose.status}`, 'success'); void fetchAll(); }} />}

      {pendingDeleteNote && <CaseNoteDeletionReview key={`${caseData.id}:${pendingDeleteNote.id}`} caseId={caseData.id} noteId={pendingDeleteNote.id} onClose={() => { setPendingDeleteNote(null); void fetchAll(); }} onSaved={() => { setPendingDeleteNote(null); toast('Reviewed note permanently deleted.', 'success'); void fetchAll(); }} />}

      {confirmingDelete && <CaseDeletionReview key={`removal-${caseData.id}`} caseId={caseData.id} onClose={() => { setConfirmingDelete(false); void fetchAll(); }} onDeleted={() => { setConfirmingDelete(false); toast(`Case #${caseData.id} deleted.`, 'success'); navigate('/cases'); }} />}

      {isOwner && editingResolution && <CaseResolutionReview key={`resolution-${caseData.id}`} caseId={caseData.id} initialResolution={caseData.resolution ?? ''} onClose={() => { setEditingResolution(false); void fetchAll(); }} onSaved={() => { setEditingResolution(false); toast('Reviewed resolution text updated.', 'success'); void fetchAll(); }} />}

      {isOwner && showEdit && <CaseDetailsReview key={`details-${caseData.id}`} caseId={caseData.id} initialTitle={caseData.title} initialSummary={caseData.summary ?? ''} onClose={() => { setShowEdit(false); void fetchAll(); }} onSaved={() => { setShowEdit(false); toast('Reviewed investigation details updated.', 'success'); void fetchAll(); }} />}

      {isOwner && noteTarget && <CaseEvidenceNoteDialog key={`${caseId}:${noteTarget.kind}:${noteTarget.id}`} caseId={Number(caseId)} kind={noteTarget.kind} recordId={noteTarget.id} onCancel={() => { setNoteTarget(null); void fetchAll(); }} onSaved={(noteId, created) => { setNoteTarget(null); toast(created ? 'Reviewed evidence note saved. Original evidence and case state kept.' : 'Existing identical note found. No duplicate was added.', 'success'); const params = new URLSearchParams(searchParams); params.set('note', String(noteId)); navigate(`/cases/${caseId}?${params}`, { replace: true }); void fetchAll(); }} />}

      {isOwner && unlinkTarget && <CaseEvidenceUnlinkDialog key={`${caseId}:${unlinkTarget.kind}:${unlinkTarget.id}`} caseId={Number(caseId)} kind={unlinkTarget.kind} recordId={unlinkTarget.id} onCancel={() => { setUnlinkTarget(null); void fetchAll(); }} onUnlinked={() => { setUnlinkTarget(null); toast('Reviewed evidence relationship removed. Original evidence kept.', 'success'); void fetchAll(); }} />}

      {showLinkAlert && <CaseEvidencePicker key={`alert-${caseId}`} caseId={Number(caseId)} kind="alert" onCancel={() => { setShowLinkAlert(false); void fetchAll(); }} onLinked={created => { setShowLinkAlert(false); toast(created ? 'Alert linked to the case.' : 'Alert was already linked. Reloading the case.', 'success'); void fetchAll(); }} />}
      {showLinkEvent && <CaseEvidencePicker key={`event-${caseId}`} caseId={Number(caseId)} kind="event" onCancel={() => { setShowLinkEvent(false); void fetchAll(); }} onLinked={created => { setShowLinkEvent(false); toast(created ? 'Event linked to the case.' : 'Event was already linked. Reloading the case.', 'success'); void fetchAll(); }} />}
    </div>
  );
}
