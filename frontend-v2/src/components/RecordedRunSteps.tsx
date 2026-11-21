import { useState } from 'react';
import { DetectionRunReceipt } from './DetectionRunReceipt';
import { TriageGroupReceipt } from './TriageGroupReceipt';
import { saveHuntDownload } from '../utils/huntEvidence';
export interface RecordedStep { id: number; step_number: number; action: string; input_summary: string | null; output_summary: string | null; tool_used: string | null; duration_ms: number | null }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function RecordedRunSteps({ runId, agentType, steps }: { runId: number; agentType: string; steps: RecordedStep[] }) {
  const [search, setSearch] = useState(''), [action, setAction] = useState(''), [tool, setTool] = useState(''), [field, setField] = useState('all'), [page, setPage] = useState(1), [error, setError] = useState('');
  const [loadedAt] = useState(() => new Date().toISOString());
  const valid = Array.isArray(steps) && new Set(steps.map(step => step?.id)).size === steps.length && steps.every(step => step && Number.isSafeInteger(step.id) && step.id > 0 && Number.isSafeInteger(step.step_number) && step.step_number >= 0 && typeof step.action === 'string' && ['input_summary', 'output_summary', 'tool_used'].every(key => (step as unknown as Record<string, unknown>)[key] === null || typeof (step as unknown as Record<string, unknown>)[key] === 'string') && (step.duration_ms === null || (Number.isSafeInteger(step.duration_ms) && step.duration_ms >= 0)));
  if (!valid) return <p role="alert" className="text-sm text-danger">Recorded step data is malformed. No step counts, absence or filtered download are inferred. Close and reopen the run.</p>;
  const sorted = [...steps].sort((a, b) => a.step_number - b.step_number || a.id - b.id);
  const query = search.trim().toLowerCase();
  const fields = ['id', 'step_number', 'action', 'tool_used', 'duration_ms', 'input_summary', 'output_summary'] as const;
  const matches = sorted.filter(step => (!action || step.action === action.slice(6)) && (!tool || (tool === 'missing' ? step.tool_used === null || step.tool_used === '' : step.tool_used === tool.slice(6))) && (!query || (field === 'all' ? fields : fields.filter(key => key === field)).some(key => step[key] !== null && String(step[key]).toLowerCase().includes(query))));
  const pages = Math.max(1, Math.ceil(matches.length / 20)), currentPage = Math.min(page, pages);
  const reset = () => { setPage(1); setError(''); };
  const download = () => {
    setError('');
    if (!matches.length || matches.length > 5000) return;
    try {
      const content = JSON.stringify({ format: 'onealert_loaded_run_step_selection_v1', run_id: runId, agent_type: agentType, loaded_at: loadedAt, exported_at: new Date().toISOString(), filters: { literal_text: search.trim(), field, action: action ? action.slice(6) : null, tool: tool.startsWith('value:') ? tool.slice(6) : tool === 'missing' ? '(not recorded)' : null }, loaded_step_count: steps.length, matching_step_count: matches.length, steps: matches.map(step => ({ id: step.id, step_number: step.step_number, action: step.action, tool_used: step.tool_used, duration_ms: step.duration_ms, input_summary: step.input_summary, output_summary: step.output_summary })), scope: 'Only matching loaded step summaries across local pages, not the full run export, a full transcript, immutable archive or proof of action success. Recorded summaries can be shortened and running runs incomplete. Search is literal and does not infer missing activity. Contains potentially sensitive recorded input/output text. Review before sharing. No new read, agent execution or permission change.' }, null, 2) + '\n';
      saveHuntDownload(content, `agent-run-${runId}-matching-loaded-steps.json`, 'application/json');
    } catch { setError('Matching loaded steps could not be downloaded. The run and filters are unchanged.'); }
  };
  return <section aria-label="Explore loaded recorded run steps" className="space-y-3">
    <h3 className="text-sm font-semibold text-surface-100">Recorded steps ({steps.length})</h3>
    <p className="text-xs text-surface-400">Search literal text across all loaded step summaries before paging. Filters use recorded action/tool labels, not verified external activity or success. Missing summaries do not establish that no work occurred. The full run download above remains unfiltered and performs a fresh read.</p>
    {!!steps.length && <>
      <label className="block text-xs text-surface-300">Search loaded recorded steps<input aria-label="Search loaded recorded steps" type="search" maxLength={200} value={search} onChange={event => { setSearch(event.target.value); reset(); }} className={`${control} mt-1 block w-full`} /></label>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Recorded step search field" value={field} onChange={event => { setField(event.target.value); reset(); }} className={control}><option value="all">All recorded step fields</option>{fields.map(key => <option key={key} value={key}>{key.replaceAll('_', ' ')}</option>)}</select>
        <select aria-label="Recorded step action filter" value={action} onChange={event => { setAction(event.target.value); reset(); }} className={control}><option value="">All recorded actions</option>{Array.from(new Set(steps.map(step => step.action))).sort().map(value => <option key={value} value={`value:${value}`}>{value || '(empty action)'}</option>)}</select>
        <select aria-label="Recorded step tool filter" value={tool} onChange={event => { setTool(event.target.value); reset(); }} className={control}><option value="">All recorded tools</option><option value="missing">Tool not recorded</option>{Array.from(new Set(steps.map(step => step.tool_used).filter((value): value is string => !!value))).sort().map(value => <option key={value} value={`value:${value}`}>{value}</option>)}</select>
        <button type="button" className={control} onClick={() => { setSearch(''); setAction(''); setTool(''); setField('all'); reset(); }}>Clear step filters</button>
      </div>
      <p role="status" className="text-xs text-surface-300">{matches.length} of {steps.length} loaded steps match. Page {currentPage} of {pages}.</p>
      <button type="button" className={control} disabled={!matches.length || matches.length > 5000} onClick={download}>Download matching loaded steps JSON</button>
      <p className="text-xs text-surface-400">Includes all matching loaded steps across pages, their complete recorded input/output summaries and applied filters, not the full run or unrecorded activity. Maximum 5,000 matching steps; larger selections require narrower filters. Sensitive summaries have no application access controls after download. Nothing is sent to another person.</p>
    </>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {!steps.length ? <p className="text-sm text-surface-400">No steps recorded in this snapshot. This does not establish that no work occurred.</p> : !matches.length ? <p className="text-sm text-surface-400">No loaded step summaries match these filters. This does not establish that the activity did not occur.</p> : <>
      <ol aria-label="Matching recorded steps" className="space-y-3">{matches.slice((currentPage - 1) * 20, currentPage * 20).map(step => <li key={step.id} className="min-w-0 rounded-lg border border-surface-700 p-3">
        <h4 className="break-words text-sm font-semibold text-surface-100">{step.step_number}. {step.action}</h4>
        <p className="mt-1 break-words text-xs text-surface-400">Step record #{step.id} · Tool: {step.tool_used || 'Not recorded'} · Duration: {step.duration_ms === null ? 'Not recorded' : `${step.duration_ms.toLocaleString()} ms`}</p>
        {agentType === 'detect' && step.action === 'detection_review_receipt' && <DetectionRunReceipt text={step.output_summary} runId={runId} />}
        {agentType === 'triage' && step.action === 'triage_group_outcome' && <TriageGroupReceipt text={step.output_summary} />}
        <dl className="mt-3 space-y-3 text-sm"><div><dt className="text-xs text-surface-400">Recorded input summary</dt><dd className="mt-1 whitespace-pre-wrap break-words text-surface-300">{step.input_summary ?? 'Not recorded'}</dd></div>{!(agentType === 'detect' && step.action === 'detection_review_receipt') && <div><dt className="text-xs text-surface-400">Recorded output summary</dt><dd className="mt-1 whitespace-pre-wrap break-words text-surface-300">{step.output_summary ?? 'Not recorded'}</dd></div>}</dl>
      </li>)}</ol>
      <nav aria-label="Recorded step result pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous matching steps</button><button type="button" className={control} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>More matching steps</button></nav>
    </>}
  </section>;
}
