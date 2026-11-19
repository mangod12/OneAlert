import type { Alert, EpssScore, RemediationAction } from '../api/types';
import apiClient from '../api/client';
import { MentionTextarea } from './MentionTextarea';
import { useAuthStore } from '../stores/authStore';
import { getApiErrorMessage } from '../api/errors';
import { X, ExternalLink, Wrench, FolderOpen, Briefcase, Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from './ui/StatusBadge';
import { alertSeverityTones, alertStatusTones } from './ui/tones';
import { useDialogFocus } from './ui/useDialogFocus';

const actionTypeLabels: Record<string, string> = {
  patch: 'Patch',
  compensating_control: 'Compensating control',
  network_segmentation: 'Network segmentation',
  firmware_upgrade: 'Firmware upgrade',
  accept_risk: 'Accept risk',
};

interface Props {
  alert: Alert;
  onClose: () => void;
  onAcknowledge: (id: number) => void;
  onResolve: (id: number) => void;
  onReopen: (id: number) => void;
  onSnooze: (id: number, hours: number | null) => void;
  onAssigned: (id: number, assigneeId: number | null, assigneeEmail: string | null) => void;
}

interface OrgMember {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

interface LinkedCase {
  id: number;
  title: string;
  status: string;
  severity: string;
  created_at: string;
}

interface AlertNote {
  id: number;
  alert_id: number;
  user_id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
}

interface AlertActivity {
  id: number;
  action: string;
  detail: string | null;
  timestamp: string | null;
}

export function AlertDetail({ alert, onClose, onAcknowledge, onResolve, onReopen, onSnooze, onAssigned }: Props) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, [alert.snoozed_until]);
  const isSnoozed = !!alert.snoozed_until && now !== null && new Date(alert.snoozed_until).getTime() > now;
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  const [epss, setEpss] = useState<EpssScore | null>(null);
  const [kev, setKev] = useState<{ date_added: string | null; due_date: string | null; known_ransomware_campaign_use: string | null; required_action: string | null } | null>(null);
  const [remediations, setRemediations] = useState<RemediationAction[] | null>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const [notes, setNotes] = useState<AlertNote[] | null>(null);
  const [activity, setActivity] = useState<AlertActivity[] | null>(null);
  const [linkedCases, setLinkedCases] = useState<LinkedCase[] | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [watchers, setWatchers] = useState<Array<{ user_id: number; email: string; full_name: string | null }>>([]);
  const [watchBusy, setWatchBusy] = useState(false);
  const currentUserId = useAuthStore(state => state.user?.id ?? null);
  // Assignment is owner-only on the API; everyone else keeps the actions below.
  const isOwner = currentUserId === null || alert.user_id === currentUserId;
  const isWatching = currentUserId !== null && watchers.some(w => w.user_id === currentUserId);
  const watchCandidates = members.filter(m => !watchers.some(w => w.user_id === m.id));

  useEffect(() => {
    apiClient.get<OrgMember[]>('/orgs/me/members')
      .then(res => setMembers(res.data.filter(m => m.is_active)))
      .catch(() => setMembers([]));
  }, []);

  const handleAssign = async (value: string) => {
    if (assigning) return;
    setAssigning(true);
    setAssignError(null);
    const assigneeId = value === '' ? null : Number(value);
    try {
      await apiClient.patch(`/alerts/${alert.id}`, { assigned_to_id: assigneeId });
      const member = members.find(m => m.id === assigneeId) ?? null;
      onAssigned(alert.id, assigneeId, member ? member.email : null);
    } catch (error: unknown) {
      setAssignError(getApiErrorMessage(error, 'The alert could not be assigned.'));
    } finally {
      setAssigning(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    apiClient.get<Array<{ user_id: number; email: string; full_name: string | null }>>(`/alerts/${alert.id}/watchers`)
      .then(res => { if (!cancelled) setWatchers(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setWatchers([]); });
    return () => { cancelled = true; };
  }, [alert.id]);

  const refreshWatchers = async () => {
    try {
      const res = await apiClient.get(`/alerts/${alert.id}/watchers`);
      setWatchers(Array.isArray(res.data) ? res.data : []);
    } catch { setWatchers([]); }
  };

  const toggleWatch = async () => {
    if (watchBusy) return;
    setWatchBusy(true);
    try {
      if (isWatching) await apiClient.delete(`/alerts/${alert.id}/watch`);
      else await apiClient.post(`/alerts/${alert.id}/watch`);
      await refreshWatchers();
    } catch { /* the button simply keeps its previous state */ }
    finally { setWatchBusy(false); }
  };

  const addWatcher = async (value: string) => {
    if (!value) return;
    try {
      const res = await apiClient.post(`/alerts/${alert.id}/watchers`, { user_id: Number(value) });
      setWatchers(Array.isArray(res.data) ? res.data : []);
    } catch { /* the select stays put */ }
  };

  const removeWatcher = async (userId: number) => {
    try {
      await apiClient.delete(`/alerts/${alert.id}/watchers/${userId}`);
      setWatchers(prev => prev.filter(w => w.user_id !== userId));
    } catch { /* the chip stays put */ }
  };

  useEffect(() => {
    let cancelled = false;
    apiClient.get<LinkedCase[]>(`/alerts/${alert.id}/cases`)
      .then(res => { if (!cancelled) setLinkedCases(res.data); })
      .catch(() => { if (!cancelled) setLinkedCases([]); });
    return () => { cancelled = true; };
  }, [alert.id]);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<AlertNote[]>(`/alerts/${alert.id}/notes`)
      .then(res => { if (!cancelled) setNotes(res.data); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [alert.id]);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<AlertActivity[]>(`/alerts/${alert.id}/activity`)
      .then(res => { if (!cancelled) setActivity(res.data); })
      .catch(() => { if (!cancelled) setActivity([]); });
    return () => { cancelled = true; };
  }, [alert.id]);

  const addNote = async () => {
    const body = noteDraft.trim();
    if (!body || noteSaving) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const res = await apiClient.post<AlertNote>(`/alerts/${alert.id}/notes`, { body });
      setNotes(current => [...(current ?? []), res.data]);
      setNoteDraft('');
    } catch (error: unknown) {
      setNoteError(getApiErrorMessage(error, 'The note could not be saved.'));
    } finally {
      setNoteSaving(false);
    }
  };

  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteDraft, setEditNoteDraft] = useState('');

  const saveNoteEdit = async (noteId: number) => {
    const body = editNoteDraft.trim();
    if (!body) return;
    try {
      const res = await apiClient.patch<AlertNote>(`/alerts/${alert.id}/notes/${noteId}`, { body });
      setNotes(current => current?.map(note => (note.id === noteId ? res.data : note)) ?? current);
      setEditingNoteId(null);
    } catch (error: unknown) {
      setNoteError(getApiErrorMessage(error, 'The note could not be saved.'));
    }
  };

  const deleteNote = async (noteId: number) => {
    try {
      await apiClient.delete(`/alerts/${alert.id}/notes/${noteId}`);
      setNotes(current => current?.filter(note => note.id !== noteId) ?? current);
    } catch (error: unknown) {
      setNoteError(getApiErrorMessage(error, 'The note could not be deleted.'));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const kevRequest = alert.cve_id
        ? apiClient.get<{ entries: Record<string, { date_added: string | null; due_date: string | null; known_ransomware_campaign_use: string | null; required_action: string | null }> }>('/alerts/kev-batch', { params: { cve_ids: alert.cve_id } })
        : Promise.reject(new Error('no cve'));
      const [epssResult, remediationResult, kevResult] = await Promise.allSettled([
        apiClient.get<EpssScore>(`/alerts/${alert.id}/epss`),
        apiClient.get<RemediationAction[]>(`/alerts/${alert.id}/remediations`),
        kevRequest,
      ]);
      if (cancelled) return;
      if (epssResult.status === 'fulfilled') setEpss(epssResult.value.data);
      if (remediationResult.status === 'fulfilled') setRemediations(remediationResult.value.data);
      if (kevResult.status === 'fulfilled' && alert.cve_id) setKev(kevResult.value.data.entries?.[alert.cve_id] ?? null);
    };
    void load();
    return () => { cancelled = true; };
  }, [alert.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={onClose}></div>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="alert-detail-title" className="animate-in relative h-full w-full max-w-lg overflow-y-auto border-l border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]">
        <div className="flex items-center justify-between mb-2">
          <h2 id="alert-detail-title" className="text-lg font-semibold font-mono text-surface-50">{alert.cve_id}</h2>
          <button
            onClick={() => void toggleWatch()}
            disabled={watchBusy}
            aria-label={isWatching ? 'Stop watching this alert' : 'Watch this alert'}
            aria-pressed={isWatching}
            className={`grid h-9 w-9 place-items-center rounded-md hover:bg-surface-800 disabled:opacity-40 ${isWatching ? 'text-accent-400' : 'text-surface-400 hover:text-surface-50'}`}
          >
            {isWatching
              ? <EyeOff className="w-5 h-5" aria-hidden="true" />
              : <Eye className="w-5 h-5" aria-hidden="true" />}
          </button>
          <button onClick={onClose} aria-label="Close alert details" className="grid h-9 w-9 place-items-center rounded-md text-surface-400 hover:bg-surface-800 hover:text-surface-50">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-2 mb-6">
          <StatusBadge tone={alertSeverityTones[alert.severity] ?? 'neutral'}>{alert.severity}</StatusBadge>
          <StatusBadge tone={alertStatusTones[alert.status] ?? 'neutral'}>{alert.status}</StatusBadge>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">Title</label>
            <p className="text-surface-200 mt-1">{alert.title}</p>
          </div>

          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">CVSS</label>
            <p className="text-surface-200 mt-1">{alert.cvss_score ?? 'N/A'}</p>
          </div>

          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">Affected Asset</label>
            <p className="text-surface-200 mt-1">{alert.asset_name} ({alert.asset_vendor} {alert.asset_product})</p>
          </div>

          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">Description</label>
            <p className="text-surface-300 mt-1 text-sm leading-relaxed">{alert.description}</p>
          </div>

          {epss && (
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">Exploit probability (EPSS)</label>
              {epss.epss_score != null ? (
                <p className="text-surface-200 mt-1 text-sm">
                  {(epss.epss_score * 100).toFixed(1)}%
                  {epss.epss_percentile != null && (
                    <span className="text-surface-400"> · higher than {(epss.epss_percentile * 100).toFixed(0)}% of CVEs</span>
                  )}
                </p>
              ) : (
                <p className="text-surface-400 mt-1 text-sm">{epss.message ?? 'EPSS data not available'}</p>
              )}
            </div>
          )}

          {kev && (
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">CISA Known Exploited Vulnerability</label>
              <div className="mt-1 rounded-md border border-danger/30 bg-danger/10 p-3 space-y-1.5">
                <p className="text-sm font-semibold text-danger">Listed in the KEV catalog — active exploitation reported</p>
                {kev.date_added && <p className="text-xs text-surface-300">Added {kev.date_added}{kev.due_date ? ` · remediation due ${kev.due_date}` : ''}</p>}
                {kev.known_ransomware_campaign_use === 'Known' && (
                  <p className="text-xs font-medium text-danger">Used in ransomware campaigns</p>
                )}
                {kev.required_action && <p className="text-xs text-surface-400">{kev.required_action}</p>}
              </div>
            </div>
          )}

          {alert.remediation && (
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">Remediation</label>
              <p className="text-surface-300 mt-1 text-sm">{alert.remediation}</p>
            </div>
          )}

          {remediations && remediations.length > 0 && (
            <div>
              <label className="flex items-center gap-1.5 text-xs text-surface-500 uppercase tracking-wide">
                <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                Remediation plan
              </label>
              <ol className="mt-2 space-y-2">
                {[...remediations].sort((a, b) => a.priority - b.priority).map((action) => (
                  <li key={action.id} className="rounded-md border border-surface-700 bg-surface-800/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-primary-300">
                        {actionTypeLabels[action.action_type] ?? action.action_type}
                      </span>
                      <StatusBadge tone="neutral">{action.status}</StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-surface-300">{action.description}</p>
                    <p className="mt-1 text-xs text-surface-500">
                      {action.estimated_downtime_minutes != null && `${action.estimated_downtime_minutes} min downtime`}
                      {action.estimated_downtime_minutes != null && action.requires_maintenance_window && ' · '}
                      {action.requires_maintenance_window && 'Needs a maintenance window'}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {linkedCases !== null && linkedCases.length > 0 && (
            <LinkedCasesList cases={linkedCases} onClose={onClose} />
          )}

          <div className="pt-4 border-t border-surface-700">
            <label className="text-xs text-surface-500 uppercase tracking-wide">Notes</label>
            {notes === null ? (
              <p className="mt-2 text-xs text-surface-500">Loading notes…</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {notes.length === 0 && <li className="text-xs text-surface-500">No notes yet</li>}
                {notes.map(note => (
                  <li key={note.id} className="rounded-md border border-surface-700 bg-surface-800/50 p-3">
                    {editingNoteId === note.id ? (
                      <div className="flex items-start gap-2">
                        <MentionTextarea
                          aria-label="Edit note"
                          value={editNoteDraft}
                          members={members}
                          maxLength={4000}
                          rows={2}
                          onChange={setEditNoteDraft}
                          className="min-h-9 w-full rounded-md border border-surface-700 bg-surface-800 px-2.5 py-1.5 text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <button
                          type="button"
                          disabled={!editNoteDraft.trim()}
                          onClick={() => void saveNoteEdit(note.id)}
                          className="shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel note edit"
                          onClick={() => setEditingNoteId(null)}
                          className="shrink-0 rounded-md px-2 py-1.5 text-sm text-surface-400 hover:text-surface-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-surface-300 whitespace-pre-wrap">{note.body}</p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[11px] text-surface-500">
                        {new Date(note.created_at).toLocaleString()}
                        {note.edited_at && ' · edited'}
                      </span>
                      <span className="flex items-center gap-3">
                        {note.user_id === currentUserId && editingNoteId !== note.id && (
                          <button
                            type="button"
                            aria-label={`Edit note ${note.id}`}
                            onClick={() => { setEditingNoteId(note.id); setEditNoteDraft(note.body); }}
                            className="text-[11px] font-medium text-surface-500 hover:text-surface-200"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Delete note ${note.id}`}
                          onClick={() => void deleteNote(note.id)}
                          className="text-[11px] font-medium text-surface-500 hover:text-danger-400"
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-start gap-2">
              <MentionTextarea
                aria-label="Add a note"
                placeholder="Add a note… (@ to mention a teammate)"
                value={noteDraft}
                members={members}
                maxLength={4000}
                rows={2}
                onChange={setNoteDraft}
                className="min-h-9 w-full rounded-md border border-surface-700 bg-surface-800 px-2.5 py-1.5 text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="button"
                disabled={!noteDraft.trim() || noteSaving}
                onClick={() => void addNote()}
                className="shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {noteError && <p role="alert" className="mt-1.5 text-xs text-danger-400">{noteError}</p>}
          </div>

          {activity !== null && activity.length > 0 && (
            <div className="pt-4 border-t border-surface-700">
              <label className="text-xs text-surface-500 uppercase tracking-wide">Activity</label>
              <ul className="mt-2 space-y-2">
                {activity.map(entry => (
                  <li key={entry.id} className="rounded-md border border-surface-700 bg-surface-800/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-surface-200 font-medium">{entry.action}</span>
                      {entry.timestamp && (
                        <span className="shrink-0 text-[11px] text-surface-500">{new Date(entry.timestamp).toLocaleString()}</span>
                      )}
                    </div>
                    {entry.detail && <p className="mt-1 text-xs text-surface-400 break-words">{entry.detail}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alert.source && (
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">Source</label>
              <p className="text-surface-300 mt-1 text-sm">{alert.source}</p>
            </div>
          )}

          {isOwner && members.length > 0 && (
            <div className="pt-4 border-t border-surface-700">
              <label htmlFor="alert-assignee" className="block text-xs text-surface-500 mb-1.5">Assigned to</label>
              <select
                id="alert-assignee"
                value={alert.assigned_to_id ?? ''}
                disabled={assigning}
                onChange={(e) => { void handleAssign(e.target.value); }}
                className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Unassigned</option>
                {members.map(member => (
                  <option key={member.id} value={member.id}>{member.full_name ? `${member.full_name} (${member.email})` : member.email}</option>
                ))}
              </select>
              {assignError && <p role="alert" className="mt-1.5 text-xs text-danger-400">{assignError}</p>}
            </div>
          )}
          <div className="pt-4 border-t border-surface-700">
            <p className="flex items-center gap-1.5 text-xs text-surface-500 mb-1.5"><Eye className="w-3.5 h-3.5" aria-hidden="true" /> Watchers</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
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
                  aria-label="Add an alert watcher"
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
          <div className="pt-4 border-t border-surface-700 space-y-3">
            {isSnoozed ? (
              <div className="rounded-lg border border-surface-700 bg-surface-800/60 p-3 space-y-2">
                <p className="text-xs text-surface-400">
                  Snoozed until {new Date(alert.snoozed_until as string).toLocaleString()}
                </p>
                <button
                  onClick={() => onSnooze(alert.id, null)}
                  className="w-full py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg text-sm font-medium transition-colors"
                >
                  Clear snooze
                </button>
              </div>
            ) : (
              alert.status !== 'resolved' && (
                <div className="space-y-1.5">
                  <p className="text-xs text-surface-500">Snooze this alert</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[{ label: '24h', hours: 24 }, { label: '7d', hours: 168 }, { label: '30d', hours: 720 }].map(option => (
                      <button
                        key={option.hours}
                        onClick={() => onSnooze(alert.id, option.hours)}
                        aria-label={`Snooze alert for ${option.label}`}
                        className="py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg text-sm font-medium transition-colors"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
            <button
              onClick={() => setShowEscalate(true)}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg font-medium transition-colors"
            >
              <FolderOpen className="w-4 h-4" aria-hidden="true" />
              Open investigation
            </button>
            {alert.status === 'pending' && (
              <button
                onClick={() => onAcknowledge(alert.id)}
                className="w-full py-2.5 bg-primary-500 hover:bg-primary-400 text-surface-950 rounded-lg font-medium transition-colors"
              >
                Acknowledge Alert
              </button>
            )}
            {alert.status !== 'resolved' && (
              <button
                onClick={() => onResolve(alert.id)}
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-surface-800 hover:bg-surface-700 text-success rounded-lg font-medium transition-colors"
              >
                Resolve Alert
              </button>
            )}
            {alert.status === 'resolved' && (
              <button
                onClick={() => onReopen(alert.id)}
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-surface-800 hover:bg-surface-700 text-warning rounded-lg font-medium transition-colors"
              >
                Reopen Alert
              </button>
            )}
            <a
              href={`https://nvd.nist.gov/vuln/detail/${alert.cve_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg font-medium transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View on NVD
            </a>
          </div>
        </div>
      </div>
      {showEscalate && <EscalateDialog alert={alert} onCancel={() => setShowEscalate(false)} />}
    </div>
  );
}


interface EscalateDialogProps {
  alert: Alert;
  onCancel: () => void;
}

function LinkedCasesList({ cases, onClose }: { cases: LinkedCase[]; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="pt-4 border-t border-surface-700">
      <label className="text-xs text-surface-500 uppercase tracking-wide">Investigations</label>
      <ul className="mt-2 space-y-1.5">
        {cases.map(c => (
          <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-surface-700 bg-surface-800/50 px-3 py-2">
            <button
              type="button"
              onClick={() => { onClose(); navigate(`/cases/${c.id}`); }}
              className="inline-flex min-w-0 items-center gap-2 text-left text-sm text-primary-400 hover:text-primary-300"
            >
              <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{c.title}</span>
            </button>
            <StatusBadge tone="neutral">{c.status}</StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EscalateDialog({ alert, onCancel }: EscalateDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialogRef, onCancel);
  const navigate = useNavigate();
  const [title, setTitle] = useState(`Investigate ${alert.cve_id} on ${alert.asset_name}`);
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState<string>(alert.severity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post('/cases/', { title: title.trim(), summary: summary.trim() || null, severity });
      const caseId: number = res.data.id;
      await apiClient.post(`/cases/${caseId}/alerts/${alert.id}`);
      navigate(`/cases/${caseId}`);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'The investigation could not be opened.'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={() => { if (!busy) onCancel(); }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escalate-dialog-title"
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]"
      >
        <h2 id="escalate-dialog-title" className="text-lg font-semibold text-surface-50">Open investigation</h2>
        <p className="mt-1 text-sm text-surface-400">Create a case from {alert.cve_id} and link this alert to it.</p>
        <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void handleSubmit(); }}>
          <div>
            <label htmlFor="escalate-title" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Title</label>
            <input id="escalate-title" type="text" autoComplete="off" value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div>
            <label htmlFor="escalate-summary" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Summary</label>
            <textarea id="escalate-summary" rows={3} value={summary} onChange={event => setSummary(event.target.value)} placeholder="Optional context for the team" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div>
            <label htmlFor="escalate-severity" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Severity</label>
            <select id="escalate-severity" value={severity} onChange={event => setSeverity(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
              <option value="info">Info</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} disabled={busy} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{busy ? 'Opening…' : 'Open investigation'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
