interface Lead { method: 'rule' | 'ai'; title: string; severity: string; description: string; affected_ips: string[]; recommended_actions: string[] }
interface Receipt { format: string; version: number; run_id: number; window_from: string; window_until: string; total_events: number; alert_events: number; rule_count: number; ai_count: number; ai_status: string; included: number; omitted: number; limit: number; findings: Lead[]; scope: string }
function parse(text: string | null, runId: number): Receipt | null {
  try {
    const p = JSON.parse(text || '') as Receipt;
    const number = (x: number) => Number.isSafeInteger(x) && x >= 0;
    const strings = (x: string[], max: number, size: number) => Array.isArray(x) && x.length <= max && x.every(s => typeof s === 'string' && Array.from(s).length <= size);
    if (p.format !== 'onealert-detection-review' || p.version !== 1 || p.run_id !== runId || p.limit !== 30
      || ![p.included, p.omitted, p.total_events, p.alert_events, p.rule_count, p.ai_count].every(number)
      || p.included > 30 || p.included + p.omitted !== p.rule_count + p.ai_count
      || !['completed', 'failed', 'skipped'].includes(p.ai_status) || (p.ai_status !== 'completed' && p.ai_count !== 0) || typeof p.scope !== 'string' || !p.scope
      || typeof p.window_from !== 'string' || typeof p.window_until !== 'string' || !Number.isFinite(Date.parse(p.window_from))
      || !Number.isFinite(Date.parse(p.window_until)) || Date.parse(p.window_from) > Date.parse(p.window_until)
      || !Array.isArray(p.findings) || p.findings.length !== p.included
      || p.findings.filter(f => f?.method === 'rule').length !== Math.min(p.rule_count, p.included)
      || !p.findings.every((f, index) => f?.method === (index < p.rule_count ? 'rule' : 'ai'))
      || !p.findings.every(f => f && ['rule', 'ai'].includes(f.method) && typeof f.title === 'string' && Array.from(f.title).length <= 160
        && typeof f.description === 'string' && Array.from(f.description).length <= 800 && ['info', 'low', 'medium', 'high', 'critical'].includes(f.severity)
        && strings(f.affected_ips, 10, 64) && strings(f.recommended_actions, 5, 240))) return null;
    return p;
  } catch { return null; }
}
export function DetectionRunReceipt({ text, runId }: { text: string | null; runId: number }) {
  const receipt = parse(text, runId);
  if (!receipt) return <p role="alert" className="mt-3 text-xs text-warning">The saved detection review receipt could not be verified for this run. Do not infer an all-clear from missing leads.</p>;
  return <section aria-label="Saved detection review leads" className="mt-3 space-y-3">
    <h5 className="text-sm font-semibold text-surface-100">Saved detection review leads</h5>
    <p className="text-xs text-surface-400">{receipt.scope}</p>
    <p className="break-words text-xs text-surface-300">Recorded window: {new Date(receipt.window_from).toLocaleString()} to {new Date(receipt.window_until).toLocaleString()}. {receipt.total_events} event records, {receipt.alert_events} alert-type event records. AI analysis: {receipt.ai_status}.</p>
    <p className="text-xs text-surface-400">{receipt.rule_count} rule leads + {receipt.ai_count} AI leads. Showing {receipt.included}; {receipt.omitted} omitted by the saved receipt limit. No deduplication or corroboration is implied.</p>
    {receipt.ai_status === 'failed' && <p className="text-xs text-warning">AI analysis was unavailable or invalid. Only rule leads were retained. This is an incomplete review.</p>}
    {receipt.included === 0 && <p className="text-xs text-surface-400">No leads recorded in this receipt. This does not establish that the environment is safe.</p>}
    <ol className="space-y-3">{receipt.findings.map((lead, index) => <li key={index} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300">
      <p className="break-words font-semibold text-surface-100">{index + 1}. {lead.title}</p>
      <p>{lead.method === 'rule' ? 'Rule-derived lead' : 'AI-generated lead'} · Suggested severity: {lead.severity}</p>
      <p className="whitespace-pre-wrap break-words">{lead.description}</p>
      <p className="break-words">Affected IP labels: {lead.affected_ips.join(', ') || 'None recorded'}. These labels are not event-level attribution.</p>
      {lead.recommended_actions.length > 0 && <div><p>Suggested next steps, not executed:</p><ul className="list-disc space-y-1 pl-4">{lead.recommended_actions.map((action, i) => <li key={i} className="break-words">{action}</li>)}</ul></div>}
    </li>)}</ol>
  </section>;
}
