interface Receipt {
  version: number; position: number; outcome: 'case_created' | 'nonincident' | 'failed'; case_id: number | null;
  alerts_total: number; events_total: number; alert_sample_ids: number[]; event_sample_ids: number[];
  method: 'ai_sample' | 'rule_based_fallback' | 'unavailable'; alert_inputs: number | null; event_inputs: number | null;
}
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => count(v) && v > 0;
function parse(text: string | null): Receipt | null {
  try {
    const r = JSON.parse(text || '') as Receipt;
    const ids = (values: number[], total: number, limit: number) => Array.isArray(values) && values.length === Math.min(total, limit) && values.every(positive) && new Set(values).size === values.length;
    if (!r || r.version !== 1 || !positive(r.position) || !count(r.alerts_total) || r.alerts_total > 100 || !count(r.events_total) || r.events_total > 500 || !r.alerts_total && !r.events_total || !ids(r.alert_sample_ids, r.alerts_total, 3) || !ids(r.event_sample_ids, r.events_total, 5) || !['case_created', 'nonincident', 'failed'].includes(r.outcome) || (r.outcome === 'case_created' ? !positive(r.case_id) : r.case_id !== null)) return null;
    if (r.outcome === 'failed' ? r.method !== 'unavailable' : !['ai_sample', 'rule_based_fallback'].includes(r.method)) return null;
    if (r.method === 'unavailable' ? r.alert_inputs !== null || r.event_inputs !== null : r.alert_inputs !== (r.method === 'ai_sample' ? Math.min(20, r.alerts_total) : r.alerts_total) || r.event_inputs !== (r.method === 'ai_sample' ? Math.min(50, r.events_total) : r.events_total)) return null;
    return r;
  } catch { return null; }
}
export function TriageGroupReceipt({ text }: { text: string | null }) {
  const r = parse(text);
  if (!r) return <p className="mt-3 text-xs text-warning">This group outcome receipt is incomplete or unsupported. Use the saved step text below; do not infer an outcome or full evidence coverage.</p>;
  return <section aria-label={`Saved outcome for group ${r.position}`} className="mt-3 space-y-2 rounded border border-surface-600 p-3 text-xs text-surface-300">
    <h5 className="font-semibold text-surface-100">Group {r.position}: {r.outcome === 'case_created' ? 'Case created' : r.outcome === 'nonincident' ? 'Recorded nonincident decision' : 'Failed, needs review or retry'}</h5>
    <p>{r.alerts_total} alerts · {r.events_total} events in this run's group. Position is local to this run, not a stable cluster ID.</p>
    {r.method === 'unavailable' ? <p className="text-warning">The group did not complete. Its case, links and processed-state writes were rolled back. No completed analysis coverage is claimed.</p> : <><p>Recorded method: {r.method === 'ai_sample' ? 'AI over selected summary fields' : 'Rule-based fallback, not an AI decision'}. {r.method === 'ai_sample' ? <>Input scope: {r.alert_inputs} alert summaries and {r.event_inputs} event summaries, not full records or raw payloads.</> : <>Rule input: severity fields across {r.alert_inputs} alerts and {r.event_inputs} events, plus the first alert title or available event signature. Not an investigation of full records or raw payloads.</>}</p>{r.method === 'ai_sample' && (r.alerts_total > r.alert_inputs! || r.events_total > r.event_inputs!) && <p className="text-warning">{r.alerts_total - r.alert_inputs!} alerts and {r.events_total - r.event_inputs!} events were omitted from AI context.</p>}</>}
    {r.outcome === 'nonincident' && <p className="text-warning">A nonincident decision is not an all-clear. It does not establish that omitted evidence is safe or prevent later analysis from disagreeing.</p>}
    {r.case_id !== null && <a className="inline-block text-primary-300 underline" href={`/app/cases/${r.case_id}`}>Open saved case #{r.case_id}</a>}
    <p className="text-surface-400">Sample source IDs in intake order only, not the full group or exact AI input list. Links open current records and require current access; the records may have changed or been removed.</p>
    <div className="flex flex-wrap gap-3">{([['alert', r.alert_sample_ids], ['event', r.event_sample_ids]] as const).map(([kind, ids]) => ids.map(id => <a key={`${kind}-${id}`} className="text-primary-300 underline" href={kind === 'alert' ? `/app/alerts?alert=${id}` : `/app/events/${id}`}>Open {kind} #{id}</a>))}</div>
  </section>;
}
