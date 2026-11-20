import { useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { toast } from './Toast';
import { compareValidationRuns, validationComparisonCsv, type ComparableRun, type ComparableStep, type OutcomeKind } from '../utils/validationComparison';

const control = 'min-w-0 max-w-full rounded border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-200';
const kinds: OutcomeKind[] = ['changed', 'added', 'removed', 'ambiguous', 'unchanged'];
const value = (recorded: unknown) => recorded == null ? 'Not recorded' : typeof recorded === 'boolean' ? (recorded ? 'Simulated' : 'Not simulated') : String(recorded);
function StepOutcome({ label, step }: { label: string; step?: ComparableStep }) {
  return <div className="min-w-0 space-y-1 break-all rounded bg-surface-950/50 p-3 text-xs text-surface-300"><p className="font-semibold text-surface-100">{label}</p>{step ? <><p>Result: {value(step.actual_result)}</p><p>Status: {value(step.status)}</p><p>Execution: {value(step.simulated)}</p><p>Step record #{step.id}</p></> : <p>No matching step recorded</p>}</div>;
}

export function ValidationComparison({ current, onClose }: { current: ComparableRun; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState<ComparableRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('differences');
  const [page, setPage] = useState(1);
  const request = useRef(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView?.({ block: 'start' }); return () => { request.current += 1; }; }, []);
  const load = async () => {
    const identity = ++request.current;
    setBaseline(null); setError(''); setPage(1); setLoading(false);
    if (!/^\d+$/.test(draft.trim()) || !Number.isSafeInteger(Number(draft)) || Number(draft) < 1 || Number(draft) === current.id) {
      setError('Enter a different positive run ID to compare.'); return;
    }
    const id = Number(draft);
    setLoading(true);
    try {
      const response = await apiClient.get(`/validation/runs/${id}`);
      if (identity !== request.current) return;
      const data = response.data.data as ComparableRun | undefined;
      if (!data || data.id !== id || !Array.isArray(data.steps)) throw new Error('The response did not match the requested baseline run. Retry the comparison.');
      if (typeof data.name !== 'string' || typeof data.mode !== 'string' || typeof data.status !== 'string' || data.steps.some(step => !step || typeof step.technique_id !== 'string' || typeof step.test_name !== 'string' || typeof step.id !== 'number' || (step.actual_result !== null && typeof step.actual_result !== 'string') || (step.test_type != null && typeof step.test_type !== 'string') || (step.status != null && typeof step.status !== 'string') || (step.simulated != null && typeof step.simulated !== 'boolean'))) {
        throw new Error('The baseline response did not include readable step evidence. Retry the comparison.');
      }
      setBaseline(data);
    } catch (err) { if (identity === request.current) setError(getApiErrorMessage(err, 'The baseline run could not be loaded. Check its ID and retry.')); }
    finally { if (identity === request.current) setLoading(false); }
  };
  const differences = useMemo(() => baseline ? compareValidationRuns(baseline.steps, current.steps) : [], [baseline, current.steps]);
  const query = search.trim().toLowerCase();
  const filtered = differences.filter(row => (kind === 'all' || (kind === 'differences' ? row.kind !== 'unchanged' : row.kind === kind)) && (!query || [row.technique, row.name, row.testType, ...row.baseline.flatMap(step => [step.actual_result, step.status]), ...row.current.flatMap(step => [step.actual_result, step.status])].some(item => item?.toLowerCase().includes(query))));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const shownPage = Math.min(page, pages);
  const download = () => {
    if (!baseline || !filtered.length) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([validationComparisonCsv(baseline, current, filtered)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `validation-${baseline.id}-to-${current.id}-comparison.csv`; link.click();
    } catch { toast('The comparison CSV could not be downloaded. Try again.', 'error'); }
    finally { if (url) URL.revokeObjectURL(url); }
  };
  return <section ref={panel} tabIndex={-1} aria-label="Validation outcome comparison" className="oa-panel min-w-0 scroll-mt-20 space-y-4 rounded-md p-4 focus:outline-none sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Compare recorded validation outcomes</h2><button type="button" onClick={onClose} className={control}>Close comparison</button></div>
    <p className="break-words text-sm text-surface-300">Current run #{current.id}: {current.name} · {current.mode} · {current.status}</p>
    <p className="text-xs text-surface-400">Read-only comparison. No tests are executed. Match only unique exact technique, test name and test type. Duplicate steps remain ambiguous. Compare recorded result, status and simulated flag only, not commands, expectations, timing or control details. Different scopes, modes and missing evidence can make outcomes incomparable. Differences do not prove a live detection improvement or regression.</p>
    <form onSubmit={event => { event.preventDefault(); void load(); }} className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 space-y-1 text-xs text-surface-300"><span>Baseline run ID</span><input aria-label="Baseline validation run ID" inputMode="numeric" value={draft} onChange={event => { request.current += 1; setDraft(event.target.value); setBaseline(null); setError(''); setLoading(false); }} className={`${control} block w-full`} placeholder="An owned run ID, including older history pages" /></label><button type="submit" className={control}>Compare outcomes</button></form>
    {loading && <p role="status" className="text-sm text-surface-400">Loading baseline evidence...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {baseline && <>
      <p className="break-words text-sm text-surface-300">Baseline run #{baseline.id}: {baseline.name} · {baseline.mode} · {baseline.status}</p>
      {baseline.mode !== current.mode && <p role="note" className="rounded border border-warning/30 p-3 text-sm text-warning">These runs use different execution modes. Do not treat their outcomes as equivalent tests.</p>}
      {(baseline.status !== 'completed' || current.status !== 'completed') && <p role="note" className="rounded border border-warning/30 p-3 text-sm text-warning">At least one run is not completed. Only its currently recorded evidence is compared.</p>}
      <details className="rounded border border-surface-700 p-3 text-xs text-surface-300"><summary className="cursor-pointer">Inspect recorded run scopes</summary><div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2"><div className="min-w-0"><p>Baseline #{baseline.id} scope</p><pre className="mt-1 whitespace-pre-wrap break-all">{baseline.scope == null ? 'Not recorded' : JSON.stringify(baseline.scope, null, 2)}</pre></div><div className="min-w-0"><p>Current #{current.id} scope</p><pre className="mt-1 whitespace-pre-wrap break-all">{current.scope == null ? 'Not recorded' : JSON.stringify(current.scope, null, 2)}</pre></div></div></details>
      <p className="text-xs text-surface-400">Baseline: {baseline.steps.length} recorded steps. Current: {current.steps.length} recorded steps. Totals below count identity groups, not individual steps.</p>
      <div className="flex flex-wrap gap-2">{kinds.map(item => <span key={item} className="rounded border border-surface-600 px-2 py-1 text-xs text-surface-200">{item}: {differences.filter(row => row.kind === item).length}</span>)}</div>
      {!differences.length && <p className="text-sm text-surface-400">Neither run has recorded steps. This does not prove matching detection coverage.</p>}
      <div className="flex flex-wrap gap-2"><input aria-label="Search validation comparison" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className={`${control} basis-full sm:basis-0 sm:flex-1`} placeholder="Technique, test or recorded outcome" /><select aria-label="Validation comparison change type" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }} className={control}><option value="differences">Differences only</option><option value="all">All groups</option>{kinds.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
      <p className="text-xs text-surface-400">{filtered.length} of {differences.length} groups match. Page {shownPage} of {pages}.</p>
      <button type="button" onClick={download} disabled={!filtered.length} className={`${control} disabled:opacity-40`}>Export matching outcome comparison CSV</button>
      <p className="text-xs text-surface-400">The local CSV includes all matching groups across pages and full recorded step objects on both sides. Neither run is changed.</p>
      {!filtered.length && differences.length > 0 && <p className="text-sm text-surface-400">No outcome groups match these filters.</p>}
      <div className="space-y-3">{filtered.slice((shownPage - 1) * 10, shownPage * 10).map(row => <article key={row.key} className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><div className="flex flex-wrap justify-between gap-2"><h3 className="min-w-0 break-words text-sm font-semibold text-surface-100 [overflow-wrap:anywhere]">{row.technique} · {row.name}</h3><span className="text-xs text-primary-300">{row.kind}</span></div><p className="break-all text-xs text-surface-400">Test type: {row.testType ?? 'Not recorded'}</p>{row.kind === 'ambiguous' ? <p className="text-sm text-warning">Cannot safely pair duplicate steps. Baseline has {row.baseline.length}; current has {row.current.length}. Inspect the source runs.</p> : <div className="grid min-w-0 gap-2 sm:grid-cols-2"><StepOutcome label={`Baseline #${baseline.id}`} step={row.baseline[0]} /><StepOutcome label={`Current #${current.id}`} step={row.current[0]} /></div>}</article>)}</div>
      <nav aria-label="Validation comparison pages" className="flex flex-wrap justify-between gap-2"><button type="button" disabled={shownPage === 1} onClick={() => setPage(shownPage - 1)} className={`${control} disabled:opacity-40`}>Previous outcome groups</button><button type="button" disabled={shownPage === pages} onClick={() => setPage(shownPage + 1)} className={`${control} disabled:opacity-40`}>More outcome groups</button></nav>
    </>}
  </section>;
}
