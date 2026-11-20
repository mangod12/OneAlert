import { useState } from 'react';
export interface PostureSnapshotInput { days: number; receivedAt: string; posture: unknown; sla: unknown | null; workload: unknown | null; trend: unknown | null; }
export function PostureSnapshotHandoff({ snapshot }: { snapshot: PostureSnapshotInput }) {
  const [includeTeam, setIncludeTeam] = useState(false);
  const [error, setError] = useState('');
  const missing = [snapshot.sla === null ? 'SLA compliance' : '', snapshot.workload === null ? 'Team workload' : '', snapshot.trend === null ? 'Alert trend' : ''].filter(Boolean);
  const download = () => {
    setError('');
    try {
      const body = { format: 'onealert_posture_snapshot_v1', requested_days: snapshot.days, response_received_at: snapshot.receivedAt, exported_at: new Date().toISOString(), scope: 'Loaded aggregate report responses. Different sections have different time bases and may have been read at different moments. Not an atomic database snapshot, live health check, complete underlying record export or proof of security. Missing sections remain unavailable, never zero.', sections: {
        posture: { status: 'recorded', time_basis: 'Trailing-window alert activity plus current incident/investigation state. Use the response fields for individual metric scope.', data: snapshot.posture },
        sla: { status: snapshot.sla === null ? 'unavailable' : 'recorded', time_basis: 'Selected report window. Unknown completion timing is not proof of meeting or breaching an SLA.', data: snapshot.sla },
        team_workload: { status: snapshot.workload === null ? 'unavailable' : includeTeam ? 'recorded' : 'excluded_by_export_selection', time_basis: 'Current recorded assignments and response metrics, not restricted to the selected trailing window.', data: includeTeam ? snapshot.workload : null },
        alert_trend: { status: snapshot.trend === null ? 'unavailable' : 'recorded', time_basis: 'Daily alert activity for the selected report window.', data: snapshot.trend },
      } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2) + '\n'], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `posture-snapshot-${snapshot.days}d.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('The report snapshot could not be downloaded. The loaded report is still available.'); }
  };
  return <section aria-label="Report snapshot handoff" className="oa-panel space-y-3 p-4 sm:p-5">
    <h2 className="text-sm font-semibold text-surface-100">Recorded report snapshot</h2>
    <p className="break-words text-xs text-surface-400">Requested window: {snapshot.days} days. Responses received at {snapshot.receivedAt}. Snapshot includes loaded aggregates only. Current workload and current incident state are not limited to this trailing window. Sections are separate reads, not one atomic database snapshot.</p>
    <p className="text-xs text-surface-300">{missing.length ? `Unavailable in this snapshot: ${missing.join(', ')}. Missing data will not be exported as zero.` : 'All report sections loaded. Team details are excluded from the download unless selected below.'}</p>
    <label className="flex items-start gap-2 text-xs text-surface-300"><input type="checkbox" checked={includeTeam} disabled={snapshot.workload === null} onChange={event => setIncludeTeam(event.target.checked)} className="mt-0.5" /><span>Include loaded team member names, emails and workload metrics in JSON. Review the file before sharing.</span></label>
    <button type="button" onClick={download} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Download report snapshot JSON</button>
    <p className="text-xs text-surface-400">Download does not refresh data or include the underlying SLA/workload explorer rows. A downloaded report can become stale. No recipients are contacted.</p>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}
