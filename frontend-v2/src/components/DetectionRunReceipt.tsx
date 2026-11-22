interface Lead { method: 'rule' | 'ai'; title: string; severity: string; description: string; affected_ips: string[]; recommended_actions: string[] }
interface Receipt { input_context?: unknown; format: string; version: number; run_id: number; window_from: string; window_until: string; total_events: number; alert_events: number; rule_count: number; ai_count: number; ai_status: string; included: number; omitted: number; limit: number; findings: Lead[]; scope: string }
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
const aggregateGroups = ['severity_distribution', 'top_source_ips', 'top_dest_ports', 'top_signatures'] as const;
type AggregateGroup = typeof aggregateGroups[number];
interface InputScope { format: string; max_context_characters: number; text_character_limit: number; included_groups: Record<AggregateGroup, number>; omitted_groups: Record<AggregateGroup, number>; shortened_labels: { group: AggregateGroup; position: number }[] }
function DetectionInputScope({ value }: { value: unknown }) {
  const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
  const caps = { severity_distribution: 100, top_source_ips: 10, top_dest_ports: 10, top_signatures: 10 };
  const p = value as InputScope | null;
  const valid = p && p.format === 'bounded_aggregate_json_v1' && p.max_context_characters === 64000 && [256, 128, 64, 32, 16, 8, 4, 2, 1].includes(p.text_character_limit) && p.included_groups && p.omitted_groups && Object.keys(p.included_groups).length === 4 && Object.keys(p.omitted_groups).length === 4 && aggregateGroups.every(group => positive(p.included_groups[group]) && p.included_groups[group] <= caps[group] && positive(p.omitted_groups[group])) && Array.isArray(p.shortened_labels) && p.shortened_labels.length <= 120 && new Set(p.shortened_labels.map(row => `${row?.group}:${row?.position}`)).size === p.shortened_labels.length && p.shortened_labels.every(row => row && ['severity_distribution', 'top_source_ips', 'top_signatures'].includes(row.group) && positive(row.position) && row.position >= 1 && row.position <= p.included_groups[row.group]);
  if (!valid) return <p className="text-xs text-surface-400">AI input bounds and aggregate omissions were not recorded in a supported format. Do not assume all labels or full events reached AI.</p>;
  return <section aria-label="Saved detection aggregate input scope" className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h6 className="font-semibold text-surface-100">Prepared aggregate input scope</h6><p>Bounded JSON · At most {p.text_character_limit} Unicode characters per text label · Final escaped input limited to 64,000 characters. This is prepared input scope, not confirmation of provider success, AI review, verified identities or injection-proof handling.</p><p className="text-surface-400">Counts below refer to supplied aggregate rows, not all distinct labels in the database. Existing aggregation may already omit labels. Source/port/signature groups overlap; do not add them or treat these rows as full event records.</p><dl className="grid gap-2 sm:grid-cols-2">{aggregateGroups.map(group => <div key={group}><dt className="text-surface-400">{group.replaceAll('_', ' ')}</dt><dd>{p.included_groups[group]} supplied rows included · {p.omitted_groups[group]} supplied rows omitted</dd></div>)}</dl>{p.shortened_labels.length ? <details className="text-warning"><summary className="cursor-pointer">Shortened text in {p.shortened_labels.length} supplied {p.shortened_labels.length === 1 ? 'label' : 'labels'}</summary><ul className="mt-2 space-y-1">{p.shortened_labels.map(row => <li key={`${row.group}:${row.position}`}>{row.group.replaceAll('_', ' ')}: prepared row {row.position}</li>)}</ul><p className="mt-2">Positions refer only to this prepared input. Shortened labels may look identical but remain distinct aggregate rows. Original label text is not stored in this scope receipt.</p></details> : <p>No supplied labels were shortened by this recorded context builder. This does not mean every database label was included.</p>}</section>;
}
export function DetectionRunReceipt({ text, runId }: { text: string | null; runId: number }) {
  const receipt = parse(text, runId);
  if (!receipt) return <p role="alert" className="mt-3 text-xs text-warning">The saved detection review receipt could not be verified for this run. Do not infer an all-clear from missing leads.</p>;
  return <section aria-label="Saved detection review leads" className="mt-3 space-y-3">
    <h5 className="text-sm font-semibold text-surface-100">Saved detection review leads</h5>
    <p className="text-xs text-surface-400">{receipt.scope}</p>
    <p className="break-words text-xs text-surface-300">Recorded window: {new Date(receipt.window_from).toLocaleString()} to {new Date(receipt.window_until).toLocaleString()}. {receipt.total_events} event records, {receipt.alert_events} alert-type event records. AI analysis: {receipt.ai_status}.</p>
    <p className="text-xs text-surface-400">{receipt.rule_count} rule leads + {receipt.ai_count} AI leads. Showing {receipt.included}; {receipt.omitted} omitted by the saved receipt limit. No deduplication or corroboration is implied.</p>
    {receipt.ai_status !== 'skipped' && <DetectionInputScope value={receipt.input_context} />}
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
