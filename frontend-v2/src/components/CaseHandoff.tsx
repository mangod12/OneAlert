import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
import { caseHandoff, type HandoffSnapshot, type HandoffCase, type HandoffTask, type HandoffAlert, type HandoffEvent } from '../utils/caseHandoff';

function HandoffReview({ caseId, onClose }: { caseId: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeTimeline, setIncludeTimeline] = useState(false);
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

  const text = snapshot ? caseHandoff(snapshot, includeTimeline) : '';
  const download = () => {
    if (!snapshot || error) return;
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
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-xl border border-surface-700 bg-surface-900 p-4 shadow-xl sm:p-6">
        <h2 id="handoff-title" className="text-lg font-semibold text-surface-50">Review investigation handoff</h2>
        <p id="handoff-description" className="mt-2 text-sm text-surface-300">Private local text file, nothing is sent or uploaded. Review sensitive investigation data before sharing. A fresh set of records is fetched when you open this review.</p>
        <label className="my-3 flex items-center gap-2 text-sm text-surface-200">
          <input type="checkbox" checked={includeTimeline} onChange={event => setIncludeTimeline(event.target.checked)} />
          Include recorded timeline and notes
        </label>
        {error ? <div role="alert" className="py-4 text-sm text-danger">{error}<button type="button" onClick={() => setAttempt(n => n + 1)} className="ml-3 underline">Retry handoff</button></div>
          : !snapshot ? <p role="status" className="py-6 text-sm text-surface-300">Fetching handoff records...</p>
            : <textarea aria-label="Handoff preview" readOnly value={text} className="min-h-48 flex-1 resize-none overflow-auto whitespace-pre-wrap rounded-md border border-surface-700 bg-surface-950 p-3 font-mono text-xs leading-5 text-surface-200" rows={18} />}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200">Close review</button>
          <button type="button" onClick={download} disabled={!snapshot || !!error} className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white disabled:opacity-40">Download handoff</button>
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
