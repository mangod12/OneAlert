import type { Alert } from '../api/types';
import { X, ExternalLink } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  alert: Alert;
  onClose: () => void;
  onAcknowledge: (id: number) => void;
}

const severityColors: Record<string, string> = {
  critical: 'text-danger',
  high: 'text-warning',
  medium: 'text-info',
  low: 'text-success',
};

export function AlertDetail({ alert, onClose, onAcknowledge }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}></div>
      <div className="relative w-full max-w-lg bg-surface-900 border-l border-surface-700 h-full overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">{alert.cve_id}</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">Title</label>
            <p className="text-surface-200 mt-1">{alert.title}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">Severity</label>
              <p className={clsx('mt-1 font-medium capitalize', severityColors[alert.severity])}>
                {alert.severity}
              </p>
            </div>
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">CVSS</label>
              <p className="text-surface-200 mt-1">{alert.cvss_score ?? 'N/A'}</p>
            </div>
          </div>

          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">Affected Asset</label>
            <p className="text-surface-200 mt-1">{alert.asset_name} ({alert.asset_vendor} {alert.asset_product})</p>
          </div>

          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">Description</label>
            <p className="text-surface-300 mt-1 text-sm leading-relaxed">{alert.description}</p>
          </div>

          {alert.remediation && (
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wide">Remediation</label>
              <p className="text-surface-300 mt-1 text-sm">{alert.remediation}</p>
            </div>
          )}

          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wide">Source</label>
            <p className="text-surface-300 mt-1 text-sm">{alert.source}</p>
          </div>

          <div className="pt-4 border-t border-surface-700 space-y-3">
            {alert.status === 'pending' && (
              <button
                onClick={() => onAcknowledge(alert.id)}
                className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
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
