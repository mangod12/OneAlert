import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
import { caseHandoff, type HandoffSnapshot, type HandoffCase, type HandoffTask, type HandoffAlert, type HandoffEvent, type HandoffPlan, type HandoffPlanPage } from '../utils/caseHandoff';

function HandoffReview({ caseId, onClose }: { caseId: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeTimeline, setIncludeTimeline] = useState(false);
  const [includePlans, setIncludePlans] = useState(false), [planPage, setPlanPage] = useState(1), [planRetry, setPlanRetry] = useState(0);
  const [planSnapshot, setPlanSnapshot] = useState<HandoffPlanPage | null>(null), [planError, setPlanError] = useState(''), [plansLoading, setPlansLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useDialogFocus(ref, onClose);

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError(null);
    void Promise.all([
      apiClient.get<HandoffCase>(`/cases/${caseId}`),
      apiClient.get<HandoffTask[]>(`/cases/${caseId}/tasks`),
      apiClient.get<HandoffAlert[]>(`/cases/${caseId}/alerts`),
      apiClient.get<HandoffEvent[]>(`/cases/${caseId}/events`),
    ]).then(([investigation, tasks, alerts, events]) => {
      if (!active) return;
      if (investigation.data.id !== caseId || !Array.isArray(investigation.data.timeline)
        || !Array.isArray(tasks.data) || !Array.isArray(alerts.data) || !Array.isArray(events.data)) {
        throw new Error('The handoff records could not be verified.');
      }
      setSnapshot({ investigation: investigation.data, tasks: tasks.data, alerts: alerts.data, events: events.data, capturedAt: new Date().toISOString() });
    }).catch((err: unknown) => {
      if (active) setError(getApiErrorMessage(err, 'The handoff could not be loaded. No file was created.'));
    });
    return () => { active = false; };
  }, [caseId, attempt]);

  useEffect(() => {
    let active = true; setPlanSnapshot(null); setPlanError('');
    if (!includePlans) { setPlansLoading(false); return () => { active = false; }; }
    setPlansLoading(true);
    void apiClient.get('/response-plans/', { params: { case_id: caseId, page: planPage, size: 10 } }).then(response => {
      if (!active) return;
      const value = response.data;
      if (!Array.isArray(value.data) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== planPage || value.size !== 10 || value.data.some((plan: HandoffPlan) => !plan || plan.case_id !== caseId || !Number.isSafeInteger(plan.id) || plan.id < 1 || !Array.isArray(plan.actions) || plan.actions.some(action => !action || typeof action !== 'object' || Array.isArray(action)))) throw new Error('The response plan page did not match this investigation. Retry before downloading.');
      const last = Math.max(1, Math.ceil(value.total / 10)); if (planPage > last) { setPlanPage(last); return; }
      setPlanSnapshot({ plans: value.data, page: planPage, size: 10, total: value.total, fetchedAt: new Date().toISOString() });
    }).catch(err => { if (active) setPlanError(getApiErrorMessage(err, 'Saved response plan evidence could not be loaded.')); })
      .finally(() => { if (active) setPlansLoading(false); });
    return () => { active = false; };
  }, [caseId, includePlans, planPage, planRetry]);

  const planReady = !includePlans || (!!planSnapshot && !plansLoading && !planError);
  const text = snapshot ? caseHandoff({ ...snapshot, responsePlans: includePlans ? planSnapshot ?? undefined : undefined }, includeTimeline) : '';
  const download = () => {
    if (!snapshot || error || !planReady) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `investigation-${caseId}-handoff.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-3 sm:p-6">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="handoff-title" aria-describedby="handoff-description"
        className="flex max-h-[90dvh] w-full overflow-y-auto max-w-3xl flex-col rounded-xl border border-surface-700 bg-surface-900 p-4 shadow-xl sm:p-6">
        <h2 id="handoff-title" className="text-lg font-semibold text-surface-50">Review investigation handoff</h2>
        <p id="handoff-description" className="mt-2 text-sm text-surface-300">Private local text file, nothing is sent or uploaded. Review sensitive investigation data before sharing. A fresh set of records is fetched when you open this review.</p>
        <label className="my-3 flex items-center gap-2 text-sm text-surface-200">
          <input type="checkbox" checked={includeTimeline} onChange={event => setIncludeTimeline(event.target.checked)} />
          Include recorded timeline and notes
        </label>
        <label className="mb-2 flex items-start gap-2 text-sm text-surface-200"><input type="checkbox" checked={includePlans} onChange={event => { setPlanSnapshot(null); setPlanPage(1); setIncludePlans(event.target.checked); }} />Include a loaded page of saved response plan evidence</label>
        {includePlans && <div className="mb-3 space-y-2 text-xs text-surface-300"><p>Only the selected page of plans visible to your account is included. Complete returned action lists include targets, reasons and result details that may name people or systems. Plan actor identity fields and approval-request history are omitted. This does not approve or run anything.</p>
          {plansLoading && <p role="status">Loading saved response plan page...</p>}
          {planError && <p role="alert" className="text-danger">{planError}</p>}
          <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={plansLoading || planPage === 1} onClick={() => { setPlanSnapshot(null); setPlanPage(planPage - 1); }} className="rounded border border-surface-600 px-2 py-1.5 disabled:opacity-40">Previous handoff plan page</button><span>Plan page {planPage}{planSnapshot ? ` of ${Math.max(1, Math.ceil(planSnapshot.total / 10))} · ${planSnapshot.total} visible plan records` : ''}</span><button type="button" disabled={plansLoading || !planSnapshot || planPage * 10 >= planSnapshot.total} onClick={() => { setPlanSnapshot(null); setPlanPage(planPage + 1); }} className="rounded border border-surface-600 px-2 py-1.5 disabled:opacity-40">Next handoff plan page</button><button type="button" onClick={() => { setPlanSnapshot(null); setPlanRetry(planRetry + 1); }} disabled={plansLoading} className="rounded border border-surface-600 px-2 py-1.5 disabled:opacity-40">Reload handoff plan page</button></div>
        </div>}
        {error ? <div role="alert" className="py-4 text-sm text-danger">{error}<button type="button" onClick={() => setAttempt(n => n + 1)} className="ml-3 underline">Retry handoff</button></div>
          : !snapshot ? <p role="status" className="py-6 text-sm text-surface-300">Fetching handoff records...</p>
            : <textarea aria-label="Handoff preview" readOnly value={text} className="min-h-48 flex-1 resize-none overflow-auto whitespace-pre-wrap rounded-md border border-surface-700 bg-surface-950 p-3 font-mono text-xs leading-5 text-surface-200" rows={18} />}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200">Close review</button>
          <button type="button" onClick={download} disabled={!snapshot || !!error || !planReady} className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white disabled:opacity-40">Download handoff</button>
        </div>
      </div>
    </div>
  );
}

export function CaseHandoff({ caseId }: { caseId: number }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-surface-600 px-3 py-2 text-xs text-surface-200 hover:bg-surface-800">
      <Download className="h-4 w-4" aria-hidden="true" /> Prepare handoff
    </button>
    {open && <HandoffReview key={caseId} caseId={caseId} onClose={() => setOpen(false)} />}
  </>;
}
