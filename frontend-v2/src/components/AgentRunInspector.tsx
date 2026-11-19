import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';

interface RecordedStep {
  id: number;
  step_number: number;
  action: string;
  input_summary: string | null;
  output_summary: string | null;
  tool_used: string | null;
  duration_ms: number | null;
}

interface RunDetail {
  id: number;
  agent_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  model_used: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  result_summary: string | null;
  error_message: string | null;
  steps: RecordedStep[];
}

function recordedTime(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function AgentRunInspector({ runId, onClose }: { runId: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetail(null);
    setError('');
    void apiClient.get<RunDetail>(`/cases/agents/runs/${runId}`).then(response => {
      if (!active) return;
      if (response.data.id !== runId) throw new Error('The response did not match this run. Try again.');
      setDetail(response.data);
    }).catch(err => {
      if (active) setError(getApiErrorMessage(err, 'This recorded run could not be loaded.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [runId, retry]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="agent-run-heading" className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="agent-run-heading" className="text-lg font-semibold text-surface-50">Recorded agent run #{runId}</h2>
        <button type="button" onClick={onClose} className="shrink-0 rounded-md border border-surface-600 px-3 py-1.5 text-sm text-surface-200">Close run</button>
      </div>
      <p className="mt-2 text-sm text-surface-400">Read-only ledger snapshot for your run. Summaries may be shortened by the recorder. This is not a full transcript or proof that a security action succeeded.</p>
      {loading && <p role="status" className="mt-5 text-sm text-surface-300">Loading recorded run...</p>}
      {error && <div className="mt-5 space-y-3"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200">Retry run</button></div>}
      {!loading && !error && detail && <div className="mt-5 space-y-5">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {[
            ['Agent', detail.agent_type], ['Recorded status', detail.status],
            ['Started', recordedTime(detail.started_at)], ['Completed', recordedTime(detail.completed_at)],
            ['Model', detail.model_used || 'Not recorded'],
            ['Tokens', `${detail.prompt_tokens.toLocaleString()} prompt / ${detail.completion_tokens.toLocaleString()} completion`],
          ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-surface-400">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-surface-100">{value}</dd></div>)}
        </dl>
        <section><h3 className="text-sm font-semibold text-surface-100">Recorded result</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-surface-300">{detail.result_summary || 'No result summary recorded.'}</p></section>
        {detail.error_message && <section><h3 className="text-sm font-semibold text-danger">Recorded failure</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-surface-300">{detail.error_message}</p></section>}
        <section>
          <h3 className="text-sm font-semibold text-surface-100">Recorded steps ({detail.steps.length})</h3>
          {detail.steps.length === 0 ? <p className="mt-2 text-sm text-surface-400">No steps recorded in this snapshot. This does not establish that no work occurred.</p> : <ol className="mt-3 space-y-3">
            {[...detail.steps].sort((a, b) => a.step_number - b.step_number || a.id - b.id).map(step => <li key={step.id} className="min-w-0 rounded-lg border border-surface-700 p-3">
              <h4 className="break-words text-sm font-semibold text-surface-100">{step.step_number}. {step.action}</h4>
              <p className="mt-1 break-words text-xs text-surface-400">Tool: {step.tool_used || 'Not recorded'} · Duration: {step.duration_ms === null ? 'Not recorded' : `${step.duration_ms.toLocaleString()} ms`}</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div><dt className="text-xs text-surface-400">Recorded input summary</dt><dd className="mt-1 whitespace-pre-wrap break-words text-surface-300">{step.input_summary || 'Not recorded'}</dd></div>
                <div><dt className="text-xs text-surface-400">Recorded output summary</dt><dd className="mt-1 whitespace-pre-wrap break-words text-surface-300">{step.output_summary || 'Not recorded'}</dd></div>
              </dl>
            </li>)}
          </ol>}
        </section>
      </div>}
    </div>
  </div>;
}
