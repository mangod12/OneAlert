interface Receipt { version: 1; method: 'ai_sample' | 'rule_based_fallback'; model: string | null; alerts_total: number; events_total: number; alerts_omitted: number; events_omitted: number; alert_input_ids: number[]; event_input_ids: number[] }
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function receipt(value: unknown): Receipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Receipt;
  if (row.version !== 1 || !['ai_sample', 'rule_based_fallback'].includes(row.method) || (row.model !== null && typeof row.model !== 'string')) return null;
  for (const key of ['alert', 'event'] as const) {
    const ids = row[`${key}_input_ids`], total = row[`${key}s_total`], omitted = row[`${key}s_omitted`];
    if (!count(total) || !count(omitted) || !Array.isArray(ids) || ids.some(id => !count(id) || id === 0) || new Set(ids).size !== ids.length || ids.length + omitted !== total) return null;
    if (row.method === 'ai_sample' && ids.length !== Math.min(total, key === 'alert' ? 20 : 50)) return null;
    if (row.method === 'rule_based_fallback' && omitted !== 0) return null;
  }
  if (row.alerts_total > 100 || row.events_total > 500 || row.alerts_total + row.events_total === 0 || (row.method === 'rule_based_fallback' && row.model !== null)) return null;
  return row;
}
export function TriageCoverageReceipt({ metadata }: { metadata: Record<string, unknown> | null }) {
  const value = receipt(metadata?.triage_coverage);
  if (!value) return <p className="mt-2 text-xs text-surface-400">Analysis input coverage was not recorded in a supported format. Do not assume that AI reviewed every linked record.</p>;
  const sampled = value.alerts_omitted + value.events_omitted > 0;
  return <section aria-label="Saved triage analysis input coverage" className="mt-3 space-y-2 rounded border border-surface-600 bg-surface-950 p-3 text-xs text-surface-300">
    <h3 className="font-semibold text-surface-100">Saved triage analysis input coverage</h3>
    <p>{value.method === 'ai_sample' ? `AI summary-field analysis · Model: ${value.model || 'Not recorded'}` : 'Rule-based fallback · No AI-generated conclusions used'}</p>
    <p>At creation: {value.alerts_total} alerts and {value.events_total} events in this correlation candidate.</p>
    {value.method === 'ai_sample' ? <><p>Sent to AI: {value.alert_input_ids.length} alert summaries and {value.event_input_ids.length} event summaries, not full records or raw payloads.</p>{sampled && <p className="text-warning">Limited input: {value.alerts_omitted} alerts and {value.events_omitted} events were omitted from the AI context. Linking a record does not mean the AI reviewed it. Review the omitted evidence before relying on the analysis.</p>}</> : <p>Used a severity-and-label correlation heuristic, not AI investigation of the evidence. Manual review is required; no model or AI confidence is implied.</p>}
    <details><summary className="cursor-pointer text-primary-300">Recorded input IDs at creation</summary><div className="mt-2 space-y-1"><p className="break-words">Alerts: {value.alert_input_ids.join(', ') || 'None'}</p><p className="break-words">Events: {value.event_input_ids.join(', ') || 'None'}</p></div></details>
    <p className="text-surface-400">This saved scope is not recalculated when links change. IDs are references, not immutable copies of evidence. Current records may differ or be unavailable. Correlation and generated conclusions are not proof of a common incident.</p>
  </section>;
}
