import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { saveHuntDownload } from '../utils/huntEvidence';
import { compareRecordedRuns, comparisonScope, recordedElapsed, validateComparisonRun, type ComparisonRun } from '../utils/compareRecordedRuns';
interface Selection { baseline: string; candidate: string }
interface Snapshot { run: ComparisonRun; read_at: string }
interface Pair { scope: string; baseline: Snapshot; candidate: Snapshot }
const control = 'max-w-full min-h-10 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const literal = (value: string | null) => value === null ? '(not recorded)' : value === '' ? '(empty recorded text)' : value;
const id = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export function RecordedRunComparison({ selection, onSelection }: { selection: Selection; onSelection: (value: Selection) => void }) {
  const [pair, setPair] = useState<Pair | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  const [filter, setFilter] = useState('all'), [page, setPage] = useState(1);
  const request = useRef(0), busy = useRef(false);
  const scope = JSON.stringify(selection);
  useLayoutEffect(() => { request.current++; busy.current = false; setLoading(false); setPair(null); setError(''); setDownloadError(''); setPage(1); setFilter('all'); }, [scope]);
  useEffect(() => () => { request.current++; }, []);
  const baselineId = id(selection.baseline), candidateId = id(selection.candidate), ready = baselineId !== null && candidateId !== null && baselineId !== candidateId;
  const load = async () => {
    if (!ready || busy.current) return;
    const read = ++request.current, readScope = scope; busy.current = true; setLoading(true); setPair(null); setError(''); setDownloadError(''); setPage(1); setFilter('all');
    const fetchRun = async (runId: number): Promise<Snapshot> => {
      const { data } = await apiClient.get(`/cases/agents/runs/${runId}`);
      return { run: validateComparisonRun(data, runId), read_at: new Date().toISOString() };
    };
    try {
      const [baseline, candidate] = await Promise.all([fetchRun(baselineId), fetchRun(candidateId)]);
      if (read === request.current) setPair({ scope: readScope, baseline, candidate });
    } catch (err) { if (read === request.current) setError(getApiErrorMessage(err, 'Recorded run pair could not be read. No partial comparison is shown.')); }
    finally { if (read === request.current) { busy.current = false; setLoading(false); } }
  };
  const shown = pair?.scope === scope ? pair : null, comparison = shown ? compareRecordedRuns(shown.baseline.run, shown.candidate.run) : null;
  const groups = comparison?.groups.filter(group => filter === 'all' || (filter === 'changed' ? group.baseline_only > 0 || group.candidate_only > 0 : filter === 'shared' ? group.shared > 0 : filter === 'baseline' ? group.baseline_only > 0 : group.candidate_only > 0)) ?? [];
  const pages = Math.max(1, Math.ceil(groups.length / 10)), activePage = Math.min(page, pages);
  const download = () => {
    if (!shown || !comparison) return;
    setDownloadError('');
    try { saveHuntDownload(JSON.stringify({ format: 'onealert_recorded_run_comparison_v1', exported_at: new Date().toISOString(), baseline: shown.baseline, candidate: shown.candidate, comparison, scope: comparisonScope }, null, 2) + '\n', `recorded-runs-${shown.baseline.run.id}-${shown.candidate.run.id}-comparison.json`, 'application/json'); }
    catch { setDownloadError('The loaded pair could not be downloaded. No runs or comparison settings changed.'); }
  };
  return <section aria-label="Compare two recorded agent runs" className="space-y-4 rounded-lg border border-surface-700 bg-surface-950/40 p-4">
    <div><h3 className="text-sm font-semibold text-primary-300">Review differences between two recorded runs</h3><p className="mt-2 text-xs text-surface-400">Choose runs from any library page or enter their exact IDs. Read both only when ready. This compares saved evidence, not replayed inputs, model quality or verified outcomes. Nothing is rerun.</p></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void load(); }}>
      {(['baseline', 'candidate'] as const).map(side => <label key={side} className="min-w-0 basis-full flex-1 text-xs text-surface-300 sm:basis-40">{side === 'baseline' ? 'Baseline run ID' : 'Candidate run ID'}<input aria-label={`${side === 'baseline' ? 'Baseline' : 'Candidate'} run ID`} inputMode="numeric" maxLength={16} value={selection[side]} onChange={event => onSelection({ ...selection, [side]: event.target.value })} className={`${control} mt-1 block w-full`} /></label>)}
      <button type="submit" disabled={!ready || loading} className={control}>{loading ? 'Reading both runs...' : 'Read both selected runs'}</button>
      <button type="button" className={control} onClick={() => { request.current++; busy.current = false; setPair(null); setError(''); setDownloadError(''); setLoading(false); onSelection({ baseline: '', candidate: '' }); }}>Clear run comparison</button>
    </form>
    {baselineId !== null && candidateId === baselineId && <p role="status" className="text-xs text-warning">Choose two different recorded runs.</p>}
    {error && <p role="alert" className="text-xs text-danger">{error} No partial comparison is shown. Neither side is presented as missing or successful. Select Read both selected runs to retry.</p>}
    {shown && comparison && <>
      <p className="break-words text-xs text-surface-400">Baseline read {shown.baseline.read_at} · Candidate read {shown.candidate.read_at}. Separate current reads, not an atomic snapshot. Running runs may be incomplete.</p>
      {shown.baseline.run.agent_type !== shown.candidate.run.agent_type && <p className="text-xs text-warning">These runs have different recorded agent types. Similar step text does not establish equivalent tasks.</p>}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{(['baseline', 'candidate'] as const).map(side => { const run = shown[side].run; return <section aria-label={`${side} run metadata`} key={side} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
        <h4 className="text-sm font-semibold text-surface-100">{side === 'baseline' ? 'Baseline' : 'Candidate'} #{run.id}</h4>
        <dl className="space-y-2 text-xs">{Object.entries({ Agent: run.agent_type, Status: run.status, Model: run.model_used, Started: run.started_at, Completed: run.completed_at, 'Recorded elapsed (ms)': recordedElapsed(run), 'Prompt tokens': run.prompt_tokens, 'Completion tokens': run.completion_tokens, 'Saved steps': run.steps.length }).map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="whitespace-pre-wrap break-words text-surface-200">{value === null ? (label === 'Recorded elapsed (ms)' ? '(unknown elapsed interval)' : '(not recorded)') : typeof value === 'string' ? literal(value) : value}</dd></div>)}</dl>
        <details className="text-xs text-surface-300"><summary className="cursor-pointer text-primary-300">Saved result and failure text</summary><dl className="mt-2 space-y-2"><div><dt>Result summary</dt><dd className="whitespace-pre-wrap break-words">{literal(run.result_summary)}</dd></div><div><dt>Failure text</dt><dd className="whitespace-pre-wrap break-words">{literal(run.error_message)}</dd></div></dl></details>
      </section>; })}</div>
      <p className="text-xs text-surface-300">Candidate minus baseline: {shown.candidate.run.prompt_tokens - shown.baseline.run.prompt_tokens} prompt tokens; {shown.candidate.run.completion_tokens - shown.baseline.run.completion_tokens} completion tokens. Recorded tokens are not a price, spend total or quality measure. Elapsed time is the saved start-to-completion interval, not active tool time; missing or negative intervals are unknown.</p>
      <section className="space-y-3"><h4 className="text-sm font-semibold text-surface-100">Exact saved step-content differences</h4><p className="text-xs text-surface-400">Identity uses action, tool and saved input/output text with exact case, null and empty values preserved. Duplicates count separately. IDs, ordering and duration are excluded from content identity, not discarded from original records. This does not align causally equivalent steps or prove success.</p>
        <p role="status" className="text-sm text-surface-200">{comparison.shared} shared occurrences · {comparison.baseline_only} baseline-only occurrences · {comparison.candidate_only} candidate-only occurrences</p>
        <label className="block text-xs text-surface-300">Step-content groups<select aria-label="Run comparison step groups" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} className={`${control} mt-1 block`}><option value="all">All exact content groups</option><option value="changed">Groups with count differences</option><option value="shared">Groups with shared occurrences</option><option value="baseline">Groups with baseline-only occurrences</option><option value="candidate">Groups with candidate-only occurrences</option></select></label>
        <p className="text-xs text-surface-400">{groups.length} content groups · Page {activePage} of {pages}</p>
        {!groups.length && <p className="text-xs text-surface-400">No saved content groups in this selection. This does not establish that no activity occurred.</p>}
        <ol aria-label="Compared recorded step content" className="space-y-3">{groups.slice((activePage - 1) * 10, activePage * 10).map(group => <li key={JSON.stringify(group.signature)} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
          <h5 className="break-words text-sm font-semibold text-surface-100">{literal(group.signature[0])} · {literal(group.signature[1])}</h5><p className="text-xs text-surface-400">Baseline {group.baseline.length} · Candidate {group.candidate.length} · Shared {group.shared} · Baseline-only {group.baseline_only} · Candidate-only {group.candidate_only}</p>
          <details className="text-xs text-surface-300"><summary className="cursor-pointer text-primary-300">Inspect exact saved text and source records</summary><dl className="mt-2 space-y-2">{(['input', 'output'] as const).map((label, index) => <div key={label}><dt>Recorded {label} summary</dt><dd className="whitespace-pre-wrap break-words">{literal(group.signature[index + 2])}</dd></div>)}</dl>{(['baseline', 'candidate'] as const).map(side => <p key={side} className="mt-2 break-words">{side} records: {group[side].map(step => `#${step.id} (step ${step.step_number}, ${step.duration_ms === null ? 'duration not recorded' : `${step.duration_ms} ms`})`).join('; ') || '(none)'}</p>)}</details>
        </li>)}</ol>
        <nav aria-label="Recorded run comparison pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={activePage === 1} onClick={() => setPage(activePage - 1)}>Previous comparison groups</button><button type="button" className={control} disabled={activePage === pages} onClick={() => setPage(activePage + 1)}>More comparison groups</button></nav>
      </section>
      <div className="space-y-2 border-t border-surface-700 pt-3"><button type="button" className={control} onClick={download}>Download loaded run comparison JSON</button><p className="text-xs text-surface-400">Includes both complete loaded run records, separate read times and every content group across pages, not just the selected group filter. Saved input/output and failure text can be sensitive. Keep the file private; downloaded copies have no application access controls. No new read or message is sent.</p>{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}</div>
    </>}
  </section>;
}
