import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { verifySavedBriefing, type SavedBriefing } from '../utils/caseBriefingEvidence';
import { compareBriefings } from '../utils/briefingComparison';
type Read = { row: SavedBriefing; retrievedAt: string };
export function CaseBriefingComparison({ caseId, ids }: { caseId: number; ids: number[] }) {
  const a = ids[0], b = ids[1];
  const [reads, setReads] = useState<Read[] | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setReads(null); setError('');
    if (ids.length === 2 && a !== b && [a, b].every(id => Number.isSafeInteger(id) && id > 0)) {
      void Promise.all([a, b].map(async id => {
        const { data } = await apiClient.get(`/cases/${caseId}/briefing-drafts/${id}`);
        if (data?.case_id !== caseId || data.record?.timeline_id !== id || !verifySavedBriefing(data.record, caseId)
          || typeof data.retrieved_at !== 'string' || !Number.isFinite(Date.parse(data.retrieved_at))
          || new Set(data.record.briefing.sources.map((s: { key: string }) => s.key)).size !== data.record.briefing.sources.length) {
          throw new Error('A selected briefing did not match this case, draft ID or source identity. No comparison was shown.');
        }
        return { row: data.record, retrievedAt: data.retrieved_at };
      })).then(value => { if (active) setReads(value); }).catch(err => {
        if (active) setError(getApiErrorMessage(err, 'Both selected drafts must be readable before comparing. No draft was generated.'));
      });
    }
    return () => { active = false; };
  }, [a, b, ids.length, caseId, retry]);
  if (ids.length !== 2) return <p className="text-xs text-surface-400">Select two saved draft IDs to compare their retained inputs and observations. Selection can span history pages.</p>;
  const current = reads?.length === 2 && reads[0].row.briefing.case_id === caseId && reads[0].row.timeline_id === a && reads[1].row.timeline_id === b ? reads : null;
  const diff = current ? compareBriefings(current[0].row, current[1].row) : null;
  const valid = a !== b && [a, b].every(id => Number.isSafeInteger(id) && id > 0);
  return <section aria-label="Selected briefing comparison" className="scroll-mt-24 space-y-3 rounded border border-surface-700 p-3 text-xs text-surface-300">
    <h3 className="text-sm font-semibold text-surface-100">Compare saved briefing drafts A #{a} and B #{b}</h3>
    <p>This read-only comparison performs no AI calls, writes or actions. A/B are selection order, not a claim about incident evolution. It compares retained shortened inputs and exact observation text plus source-key sets, not meaning, accuracy, full records or a verified change in security posture. Missing keys may reflect input limits or unavailable links, not deleted evidence.</p>
    {!valid ? <p role="alert" className="text-warning">Select two distinct positive draft IDs.</p> : error ? <div className="space-y-2"><p role="alert" className="text-warning">{error}</p><button type="button" onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 p-2 text-primary-300">Retry selected briefing comparison</button></div> : !current || !diff ? <p role="status">Reading both exact saved drafts...</p> : <>
      <div className="grid gap-3 md:grid-cols-2">{current.map(({ row, retrievedAt }, index) => <article key={row.timeline_id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
        <h4 className="font-semibold">{index === 0 ? 'A' : 'B'}: draft #{row.timeline_id}</h4>
        <p className="break-words">Prepared {row.briefing.captured_at}. Read {retrievedAt}.</p>
        <p>{row.briefing.mode === 'ai_draft' ? 'Unverified AI draft' : 'Metadata fallback, not an AI analysis'}</p>
        <a className="inline-block text-primary-300 underline" href={`/app/cases/${caseId}?briefing=${row.timeline_id}`}>Open exact draft #{row.timeline_id}</a>
        {(['alert', 'event'] as const).map(kind => <p key={kind}>{kind}: {row.briefing.scope[kind].included} retained; {row.briefing.scope[kind].omitted} omitted; {row.briefing.scope[kind].unavailable} unavailable links.</p>)}
        <h5 className="font-semibold">Recorded gaps</h5>{row.briefing.gaps.length ? row.briefing.gaps.map((text, i) => <p key={i} className="whitespace-pre-wrap break-words">{text}</p>) : <p>No gaps listed, not proof of complete evidence.</p>}
      </article>)}</div>
      <p>{diff.sources.filter(s => s.change === 'only_a').length} source keys only in A; {diff.sources.filter(s => s.change === 'only_b').length} only in B; {diff.sources.filter(s => s.change === 'different').length} shared keys with different retained metadata; {diff.sources.filter(s => s.change === 'same').length} with identical retained metadata.</p>
      <details><summary className="cursor-pointer text-primary-300">Inspect retained source differences</summary><ul className="mt-2 space-y-2">{diff.sources.filter(s => s.change !== 'same').map(s => <li key={s.key} className="min-w-0 rounded border border-surface-700 p-2"><p className="break-words font-semibold">{s.key}: {s.change === 'different' ? 'Different retained metadata' : s.change === 'only_a' ? 'Only in A' : 'Only in B'}</p>{(['a', 'b'] as const).map(side => <div key={side} className="mt-2"><p>{side.toUpperCase()}:</p>{s[side] ? <pre className="whitespace-pre-wrap break-all font-sans">{JSON.stringify(s[side], null, 2)}</pre> : <p>Not retained in this draft.</p>}</div>)}</li>)}</ul></details>
      <p>{diff.shared} A observations have identical text and source-key sets in B. Reworded text counts as different, not a changed conclusion.</p>
      <div className="grid gap-3 md:grid-cols-2">{([['A', diff.onlyA], ['B', diff.onlyB]] as const).map(([label, observations]) => <article key={label} className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h4 className="font-semibold">Observations only in {label}</h4>{!observations.length && <p>None by exact text/source-key comparison.</p>}{observations.map((o, i) => <div key={i} className="space-y-1"><p className="whitespace-pre-wrap break-words">{o.text}</p><p className="break-words text-surface-400">Draft source references: {o.sources.join(', ')}. References are not independent verification.</p></div>)}</article>)}</div>
    </>}
  </section>;
}
