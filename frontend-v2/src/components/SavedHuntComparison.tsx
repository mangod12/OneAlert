import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { savedHuntEvidence, type SavedHuntSession } from '../utils/huntSessionEvidence';
import type { HuntEvidenceResult } from '../utils/huntEvidence';
import { compareRetainedHuntRows } from '../utils/compareRetainedHuntRows';
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function SavedHuntComparison({ session, evidence }: { session: SavedHuntSession; evidence: HuntEvidenceResult }) {
  const [draft, setDraft] = useState(''), [record, setRecord] = useState<ReturnType<typeof savedHuntEvidence> | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [readAt, setReadAt] = useState('');
  const [a, setA] = useState(0), [b, setB] = useState(0), [set, setSet] = useState<'onlyA' | 'onlyB' | 'shared'>('onlyA'), [page, setPage] = useState(1);
  const revision = useRef(0), busy = useRef(false);
  useEffect(() => { const invalidate = () => { revision.current++; }; return invalidate; }, []);
  const load = async () => {
    if (busy.current) return;
    const id = /^[1-9][0-9]*$/.test(draft.trim()) ? Number(draft) : null;
    setRecord(null); setError(''); setReadAt(''); setA(0); setB(0); setPage(1);
    if (id === null || !Number.isSafeInteger(id) || id === session.id) { setError('Enter a different positive saved hunt session ID.'); return; }
    const request = ++revision.current; busy.current = true; setLoading(true);
    try {
      const { data } = await apiClient.get(`/hunt/${id}`);
      if (request !== revision.current) return;
      setRecord(savedHuntEvidence(data, id)); setReadAt(new Date().toISOString());
    } catch (err) { if (request === revision.current) setError(getApiErrorMessage(err, 'The other saved hunt could not be read. No query was rerun.')); }
    finally { if (request === revision.current) { busy.current = false; setLoading(false); } }
  };
  const left = evidence.query_results?.[a], right = record?.evidence.query_results?.[b];
  let result: ReturnType<typeof compareRetainedHuntRows> | null = null, comparisonError = '';
  if (record && left && right) {
    try { result = compareRetainedHuntRows(left, right); } catch (err) { comparisonError = getApiErrorMessage(err, 'Retained rows could not be compared.'); }
  }
  const rows = result?.[set] ?? [], pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);
  return <section aria-label="Compare saved hunt evidence" className="space-y-3 rounded border border-surface-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Compare retained query rows with another saved hunt</h3>
    <p className="text-xs text-surface-400">Read-only comparison of displayed session A #{session.id} and another owned saved session B. No hunt, query, AI call or security action is run. Compares exact retained row values, not meaning, confirmed threats or all reported findings. Different hypotheses, query fields, filters, time windows, limits or execution outcomes can explain different rows. Selection order does not imply incident progression.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void load(); }}><label className="text-xs text-surface-300">Other saved hunt session ID<input aria-label="Comparison hunt session ID" inputMode="numeric" maxLength={16} value={draft} onChange={event => { revision.current++; busy.current = false; setLoading(false); setRecord(null); setError(''); setDraft(event.target.value); }} className={`${control} mt-1 block`} /></label><button type="submit" disabled={loading} className={control}>{loading ? 'Reading comparison hunt...' : 'Read other saved hunt for comparison'}</button></form>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {record && <>
      <p className="break-words text-xs text-surface-400">B #{record.session.id}: {record.session.hypothesis}. Recorded status: {record.session.status}. Read {readAt}. A remains the displayed saved read above. Neither read is an immutable version.</p>
      <a className="inline-block text-xs text-primary-300 underline" href={`/app/hunt?session=${record.session.id}`}>Open exact comparison hunt #{record.session.id}</a>
      {([['A', a, evidence, setA], ['B', b, record.evidence, setB]] as const).map(([label, value, source, select]) => <label key={label} className="block text-xs text-surface-300">{label} recorded query<select aria-label={`${label} saved query for comparison`} value={value} onChange={event => { select(Number(event.target.value)); setPage(1); }} className={`${control} ml-2`}>{source.query_results?.map((query, i) => <option key={i} value={i}>Query {i + 1}: {query.query?.description || 'Description not recorded'}</option>)}</select></label>)}
      {(!left || !right) && <p className="text-xs text-warning">Both sessions need a retained query result to compare. Missing query evidence does not mean zero findings.</p>}
      {comparisonError && <p role="alert" className="text-xs text-warning">{comparisonError}</p>}
      {result && left && right && <>
        <p className="text-xs text-surface-300">A: {left.rows!.length} retained rows, {left.row_count ?? 'unknown'} reported, outcome {left.outcome ?? 'not recorded'}. B: {right.rows!.length} retained rows, {right.row_count ?? 'unknown'} reported, outcome {right.outcome ?? 'not recorded'}.</p>
        <p className="text-xs text-warning">{result.sameRecordedContext ? 'Recorded query/context fields match exactly. Missing metadata can match too; this does not establish equivalent execution or complete evidence.' : 'Recorded query or execution context differs. Row differences must not be treated as a measured change in security posture.'}</p>
        <details className="text-xs text-surface-300"><summary className="cursor-pointer text-primary-300">Review recorded query contexts before interpreting differences</summary><div className="grid gap-3 md:grid-cols-2">{([['A', left], ['B', right]] as const).map(([label, query]) => <pre key={String(label)} className="min-w-0 whitespace-pre-wrap break-all rounded border border-surface-700 p-2">{String(label)}: {JSON.stringify({ query: query.query, execution: query.execution, time_window: query.time_window, outcome: query.outcome, error: query.error }, null, 2)}</pre>)}</div></details>
        <p className="text-xs text-surface-300">{result.shared.length} exact rows shared; {result.onlyA.length} only in A; {result.onlyB.length} only in B. Duplicate rows are counted separately; object field order is ignored, array order and missing versus null values are preserved. Unretained rows are not compared.</p>
        <label className="block text-xs text-surface-300">Retained row set<select aria-label="Compared retained row set" value={set} onChange={event => { setSet(event.target.value as typeof set); setPage(1); }} className={`${control} ml-2`}><option value="onlyA">Only in A</option><option value="onlyB">Only in B</option><option value="shared">Shared exact rows</option></select></label>
        {!rows.length && <p className="text-xs text-surface-400">No retained rows in this selected set. This is not proof of no threats or no change.</p>}
        <ol aria-label="Compared retained hunt rows" className="space-y-2">{rows.slice((currentPage - 1) * 10, currentPage * 10).map((row, i) => <li key={i}><pre className="whitespace-pre-wrap break-all rounded border border-surface-700 p-2 text-xs text-surface-300">{JSON.stringify(row, null, 2)}</pre></li>)}</ol>
        <nav aria-label="Compared hunt row pages" className="flex flex-wrap items-center gap-2"><button type="button" disabled={currentPage === 1} className={control} onClick={() => setPage(currentPage - 1)}>Previous compared rows</button><span className="text-xs text-surface-400">Page {currentPage} of {pages}</span><button type="button" disabled={currentPage === pages} className={control} onClick={() => setPage(currentPage + 1)}>More compared rows</button></nav>
      </>}
    </>}
  </section>;
}
