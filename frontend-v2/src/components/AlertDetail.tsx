import type { Alert, EpssScore, RemediationAction } from '../api/types';
import apiClient from '../api/client';
import { X, ExternalLink, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
}

export function AlertDetail({ alert, onClose, onAcknowledge }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  const [epss, setEpss] = useState<EpssScore | null>(null);
  const [remediations, setRemediations] = useState<RemediationAction[] | null>(null);

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

          <div className="pt-4 border-t border-surface-700 space-y-3">
            {alert.status === 'pending' && (
              <button
                onClick={() => onAcknowledge(alert.id)}
                className="w-full py-2.5 bg-primary-500 hover:bg-primary-400 text-surface-950 rounded-lg font-medium transition-colors"
              >
                Acknowledge Alert
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
    </div>
  );
}
