import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';

type Source = { key: string; kind: 'case' | 'alert' | 'event'; id: number; title?: string; label?: string; summary?: string };
type Scope = { linked: number; available: number; included: number; omitted: number; unavailable: number; limit: number };
interface Briefing {
  format: string; version: number; case_id: number; run_id: number; mode: string; captured_at: string;
  observations: { text: string; sources: string[] }[]; gaps: string[]; review_questions: string[];
  sources: Source[]; scope: { alert: Scope; event: Scope };
}
interface SavedBriefing { timeline_id: number; briefing: Briefing }
const positive = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
function verified(value: SavedBriefing, caseId: number) {
  const b = value?.briefing;
  return positive(value?.timeline_id) && b?.format === 'onealert-case-briefing' && b.version === 1 && b.case_id === caseId
    && positive(b.run_id) && ['ai_draft', 'recorded_metadata_fallback'].includes(b.mode)
    && typeof b.captured_at === 'string' && Number.isFinite(Date.parse(b.captured_at))
    && Array.isArray(b.sources) && b.sources.length <= 71 && b.sources.every(s => s && positive(s.id)
      && ['case', 'alert', 'event'].includes(s.kind) && s.key === `${s.kind}:${s.id}`
      && (s.kind !== 'case' || s.id === caseId)
      && [s.title, s.label, s.summary].every(t => t === undefined || typeof t === 'string'))
    && Array.isArray(b.observations) && b.observations.length > 0 && b.observations.length <= 12
    && b.observations.every(o => o && typeof o.text === 'string' && o.text.length <= 400 && Array.isArray(o.sources)
      && o.sources.length > 0 && o.sources.length <= 5 && o.sources.every(key => b.sources.some(s => s.key === key)))
    && [b.gaps, b.review_questions].every(items => Array.isArray(items) && items.length <= 6
      && items.every(t => typeof t === 'string' && t.length <= 400))
    && [b.scope?.alert, b.scope?.event].every(scope => scope && ['linked', 'available', 'included', 'omitted', 'unavailable', 'limit']
      .every(key => Number.isSafeInteger(scope[key as keyof Scope]) && scope[key as keyof Scope] >= 0)
      && scope.linked === scope.available + scope.unavailable && scope.available === scope.included + scope.omitted)
    && b.sources.filter(s => s.kind === 'case').length === 1
    && b.scope.alert.included <= 20 && b.scope.event.included <= 50
    && (['alert', 'event'] as const).every(kind => b.sources.filter(s => s.kind === kind).length === b.scope[kind].included);
}
function SourceLink({ source }: { source: Source }) {
  const href = source.kind === 'case' ? `/app/cases/${source.id}` : source.kind === 'alert'
    ? `/app/alerts?alert=${source.id}` : `/app/events/${source.id}`;
  return <a href={href} className="text-primary-300 underline">{source.kind} #{source.id}</a>;
}

export function CaseBriefingDrafts({ caseId }: { caseId: number }) {
  const [reviewing, setReviewing] = useState(false), [ack, setAck] = useState(false);
  const [records, setRecords] = useState<SavedBriefing[]>([]), [cursor, setCursor] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0), generationBusy = useRef(false), historyBusy = useRef(false);
  useEffect(() => { revision.current++; setRecords([]); setCursor(null); setLoaded(false); setReviewing(false);
    setAck(false); setError(''); setBusy(false); setLoading(false); generationBusy.current = false; historyBusy.current = false;
    const invalidate = () => { revision.current += 1; }; return invalidate;
  }, [caseId]);
  const history = async (before?: number) => {
    if (historyBusy.current || generationBusy.current) return;
    historyBusy.current = true; const read = ++revision.current; setLoading(true); setError(''); setRecords([]); setLoaded(false); setCursor(null);
    try {
      const { data } = await apiClient.get(`/cases/${caseId}/briefing-drafts`, { params: before ? { before_id: before } : {} });
      if (read !== revision.current) return;
      if (data?.case_id !== caseId || !Array.isArray(data.records) || data.records.length > 5
        || !data.records.every((row: SavedBriefing) => verified(row, caseId))
        || (data.next_before_id !== null && !positive(data.next_before_id))) throw new Error('Saved briefings could not be verified for this case.');
      setRecords(data.records); setCursor(data.next_before_id); setLoaded(true);
    } catch (err) { if (read === revision.current) setError(getApiErrorMessage(err, 'Saved briefings could not be loaded.')); }
    finally { if (read === revision.current) { historyBusy.current = false; setLoading(false); } }
  };
  const generate = async () => {
    if (generationBusy.current || historyBusy.current || !ack) return;
    generationBusy.current = true; const read = ++revision.current; setBusy(true); setError(''); setRecords([]); setLoaded(false); setCursor(null);
    try {
      const { data } = await apiClient.post(`/cases/${caseId}/briefing-drafts`);
      if (read !== revision.current) return;
      const row = { timeline_id: data?.data?.timeline_id, briefing: data?.data?.briefing };
      if (!verified(row, caseId)) throw new Error('A draft may have been saved, but the returned receipt could not be verified. Load saved drafts before retrying.');
      setRecords([row]); setLoaded(true); setReviewing(false); setAck(false);
    } catch (err) { if (read === revision.current) setError(getApiErrorMessage(err,
      'Briefing outcome could not be confirmed. Load saved drafts before generating again; do not assume no draft was saved.')); }
    finally { if (read === revision.current) { generationBusy.current = false; setBusy(false); } }
  };
  return <section aria-label="Analyst briefing drafts" className="oa-panel space-y-3 p-4">
    <h2 className="text-sm font-semibold text-surface-100">Source-linked analyst briefing drafts</h2>
    <p className="text-xs text-surface-400">Prepare observations, evidence gaps and human-review questions from bounded recorded metadata. AI statements and their citations are unverified draft interpretations, not confirmed facts or successful containment. Nothing is sent to another person or executed.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || loading} onClick={() => { setReviewing(!reviewing); setAck(false); }} className="rounded border border-surface-600 p-2 text-xs text-primary-300 disabled:opacity-40">Review briefing draft inputs</button><button type="button" disabled={busy || loading} onClick={() => void history()} className="rounded border border-surface-600 p-2 text-xs text-primary-300 disabled:opacity-40">Load latest saved briefing drafts</button></div>
    {reviewing && <div className="space-y-3 rounded border border-surface-700 p-3 text-xs text-surface-300"><p>Generating sends the saved case title (first 500 characters), summary (2,000), status and severity, plus the first 20 owned linked alerts and 50 owned linked events in saved link order to your configured AI provider. Evidence input is IDs, labels (400 characters), severity and recorded time only. Raw payloads, URLs, assets, notes, tasks, plans and chronology are excluded. Counts disclose omitted and unavailable links. This is not a complete investigation or a frozen read.</p><p>The output is saved as a draft in this case's timeline with source excerpts and an exact run receipt. People who can read that timeline may read it. Generating does not replace the case summary, create tasks, approve plans or run actions. If AI is unavailable or invalid, a clearly marked metadata-only fallback is saved instead.</p><label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I have reviewed the input scope and want to save a briefing draft.</label><button type="button" disabled={!ack || busy || loading} onClick={() => void generate()} className="rounded border border-primary-500 p-2 text-primary-300 disabled:opacity-40">{busy ? 'Generating briefing draft...' : 'Generate and save briefing draft'}</button></div>}
    {loading && <p role="status" className="text-xs text-surface-300">Loading saved briefing drafts...</p>}
    {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
    {loaded && !records.length && <p className="text-xs text-surface-400">No saved briefing drafts on this page. This does not establish that no investigation work occurred.</p>}
    {records.map(({ timeline_id, briefing: b }) => <article key={timeline_id} className="min-w-0 space-y-3 rounded border border-surface-700 p-3 text-xs text-surface-300">
      <h3 className="font-semibold text-surface-100">Briefing draft #{timeline_id} · {b.mode === 'ai_draft' ? 'Unverified AI draft' : 'AI unavailable or invalid: metadata-only fallback'}</h3>
      <p>Draft prepared at: {b.captured_at}. Source excerpts below belong to this draft; opening a record reads its current state.</p>
      <a href={`/app/audit-log?run=${b.run_id}`} className="inline-block text-primary-300 underline">Inspect exact briefing run #{b.run_id}</a>
      {(['alert', 'event'] as const).map(kind => <p key={kind}>{kind}: {b.scope[kind].included} included / {b.scope[kind].available} available linked records; {b.scope[kind].omitted} omitted by input limit; {b.scope[kind].unavailable} unavailable links.</p>)}
      <h4 className="font-semibold">Draft observations</h4><ol className="list-inside list-decimal space-y-2">{b.observations.map((o, i) => <li key={i} className="break-words whitespace-pre-wrap">{o.text}<div className="mt-1 flex flex-wrap gap-3">{o.sources.map(key => <SourceLink key={key} source={b.sources.find(s => s.key === key)!} />)}</div></li>)}</ol>
      <h4 className="font-semibold">Draft evidence gaps</h4>{b.gaps.length ? <ul className="space-y-1">{b.gaps.map((text, i) => <li key={i} className="break-words">{text}</li>)}</ul> : <p>No gaps listed by this draft, not proof the evidence is complete.</p>}
      <h4 className="font-semibold">Questions for human review, not executed actions</h4>{b.review_questions.map((text, i) => <p key={i} className="break-words">{text}</p>)}
      <details><summary className="cursor-pointer text-primary-300">Recorded input excerpts ({b.sources.length})</summary><ul className="mt-2 space-y-2">{b.sources.map((s, i) => <li key={`${s.key}:${i}`} className="min-w-0 break-words"><SourceLink source={s} /><p className="whitespace-pre-wrap">{s.title || s.label || 'No label recorded'}</p>{s.summary && <p className="whitespace-pre-wrap">{s.summary}</p>}</li>)}</ul></details>
    </article>)}
    {cursor !== null && <button type="button" disabled={busy || loading} onClick={() => void history(cursor)} className="rounded border border-surface-600 p-2 text-xs text-primary-300">Load older briefing drafts</button>}
  </section>;
}
