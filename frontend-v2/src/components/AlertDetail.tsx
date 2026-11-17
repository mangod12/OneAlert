import type { Alert, EpssScore, RemediationAction } from '../api/types';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { X, ExternalLink, Wrench, FolderOpen } from 'lucide-react';
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
  onAssigned: (id: number, assigneeId: number | null, assigneeEmail: string | null) => void;
}

interface OrgMember {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

export function AlertDetail({ alert, onClose, onAcknowledge, onResolve, onAssigned }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  const [epss, setEpss] = useState<EpssScore | null>(null);
  const [remediations, setRemediations] = useState<RemediationAction[] | null>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

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
    const load = async () => {
      const [epssResult, remediationResult] = await Promise.allSettled([
        apiClient.get<EpssScore>(`/alerts/${alert.id}/epss`),
        apiClient.get<RemediationAction[]>(`/alerts/${alert.id}/remediations`),
      ]);
      if (cancelled) return;
      if (epssResult.status === 'fulfilled') setEpss(epssResult.value.data);
      if (remediationResult.status === 'fulfilled') setRemediations(remediationResult.value.data);
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

          {alert.source && (
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">Source</label>
              <p className="text-surface-300 mt-1 text-sm">{alert.source}</p>
            </div>
          )}

          {members.length > 0 && (
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
          <div className="pt-4 border-t border-surface-700 space-y-3">
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
