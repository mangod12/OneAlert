interface ContextBounds { format: 'bounded_json_v1'; max_context_characters: number; text_character_limit: number; shortened_fields: { kind: 'alert' | 'event'; id: number; fields: string[] }[] }
interface Receipt { input_context?: unknown; version: 1; method: 'ai_sample' | 'rule_based_fallback'; model: string | null; alerts_total: number; events_total: number; alerts_omitted: number; events_omitted: number; alert_input_ids: number[]; event_input_ids: number[] }
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
function contextBounds(value: unknown, parent: Receipt): ContextBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as ContextBounds;
  if (row.format !== 'bounded_json_v1' || row.max_context_characters !== 64000 || ![256, 128, 64, 32, 16, 8, 4, 2, 1].includes(row.text_character_limit) || !Array.isArray(row.shortened_fields) || row.shortened_fields.length > parent.alert_input_ids.length + parent.event_input_ids.length || new Set(row.shortened_fields.map(item => `${item?.kind}:${item?.id}`)).size !== row.shortened_fields.length) return null;
  if (row.shortened_fields.some(item => !item || !['alert', 'event'].includes(item.kind) || !(item.kind === 'alert' ? parent.alert_input_ids : parent.event_input_ids).includes(item.id) || !Array.isArray(item.fields) || !item.fields.length || new Set(item.fields).size !== item.fields.length || item.fields.some(field => !(item.kind === 'alert' ? ['severity', 'title', 'cve_id'] : ['severity', 'event_type', 'source_ip', 'dest_ip', 'signature', 'category']).includes(field)))) return null;
  return row;
}
export function TriageCoverageReceipt({ metadata }: { metadata: Record<string, unknown> | null }) {
  const value = receipt(metadata?.triage_coverage);
  if (!value) return <p className="mt-2 text-xs text-surface-400">Analysis input coverage was not recorded in a supported format. Do not assume that AI reviewed every linked record.</p>;
  const bounds = contextBounds(value.input_context, value);
  const sampled = value.alerts_omitted + value.events_omitted > 0;
  return <section aria-label="Saved triage analysis input coverage" className="mt-3 space-y-2 rounded border border-surface-600 bg-surface-950 p-3 text-xs text-surface-300">
    <h3 className="font-semibold text-surface-100">Saved triage analysis input coverage</h3>
    <p>{value.method === 'ai_sample' ? `AI summary-field analysis · Model: ${value.model || 'Not recorded'}` : 'Rule-based fallback · No AI-generated conclusions used'}</p>
    <p>At creation: {value.alerts_total} alerts and {value.events_total} events in this correlation candidate.</p>
    {value.method === 'ai_sample' ? <><p>Sent to AI: {value.alert_input_ids.length} alert summaries and {value.event_input_ids.length} event summaries, not full records or raw payloads.</p>{sampled && <p className="text-warning">Limited input: {value.alerts_omitted} alerts and {value.events_omitted} events were omitted from the AI context. Linking a record does not mean the AI reviewed it. Review the omitted evidence before relying on the analysis.</p>}</> : <p>Used a severity-and-label correlation heuristic, not AI investigation of the evidence. Manual review is required; no model or AI confidence is implied.</p>}
    {value.method === 'ai_sample' && <>
      {bounds ? <><p>Recorded input format: bounded JSON summaries. Text fields were limited to {bounds.text_character_limit} Unicode characters each; the final escaped context was limited to 64,000 characters. Encoding and limits do not make source text trustworthy or prevent every model error.</p>{bounds.shortened_fields.length > 0 ? <details className="text-warning"><summary className="cursor-pointer">Shortened text in {bounds.shortened_fields.length} supplied {bounds.shortened_fields.length === 1 ? 'record' : 'records'}</summary><ul className="mt-2 space-y-1">{bounds.shortened_fields.map(row => <li key={`${row.kind}:${row.id}`} className="break-words">{row.kind} #{row.id}: {row.fields.join(', ')}</li>)}</ul><p className="mt-2">Some selected field text was omitted, separately from whole-record omissions above. Review original evidence before relying on the analysis. No omitted text is stored in this receipt.</p></details> : <p>No supplied text fields were shortened by this recorded context builder. Only selected fields were sent, not full records.</p>}</> : <p className="text-surface-400">Text bounds and shortening details were not recorded in a supported format. Do not assume complete field text reached AI.</p>}
    </>}
    <details><summary className="cursor-pointer text-primary-300">Recorded input IDs at creation</summary><div className="mt-2 space-y-1"><p className="break-words">Alerts: {value.alert_input_ids.join(', ') || 'None'}</p><p className="break-words">Events: {value.event_input_ids.join(', ') || 'None'}</p></div></details>
    <p className="text-surface-400">This saved scope is not recalculated when links change. IDs are references, not immutable copies of evidence. Current records may differ or be unavailable. Correlation and generated conclusions are not proof of a common incident.</p>
  </section>;
}
