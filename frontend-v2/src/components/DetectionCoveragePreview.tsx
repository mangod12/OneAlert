import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Bucket { label: string; count: number }
interface Finding { title: string; severity: string; description: string; recommended_actions: string[] }
interface Snapshot { hours_back: number; retrieved_at: string; cutoff: string; total_events: number; alert_events: number; ai_eligible: boolean; severity_distribution: Record<string, number>; top_sources: Bucket[]; top_ports: Bucket[]; top_signatures: Bucket[]; rule_findings: Finding[] }
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
export function DetectionCoveragePreview() {
  const [open, setOpen] = useState(false), [hours, setHours] = useState(24), [retry, setRetry] = useState(0), [data, setData] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setData(null); setError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Snapshot>('/cases/detection-preview', { params: { hours_back: hours } }).then(({ data: value }) => {
      if (request !== reads.current) return;
      const buckets = (rows: Bucket[], limit: number) => Array.isArray(rows) && rows.length <= limit && rows.every(row => row && typeof row.label === 'string' && count(row.count) && row.count > 0 && row.count <= value.total_events) && new Set(rows.map(row => row.label)).size === rows.length && rows.reduce((sum, row) => sum + row.count, 0) <= value.total_events;
      if (!value || value.hours_back !== hours || !count(value.total_events) || !count(value.alert_events) || value.alert_events > value.total_events || value.ai_eligible !== (value.total_events > 5 && value.alert_events > 0) || typeof value.retrieved_at !== 'string' || typeof value.cutoff !== 'string' || !Number.isFinite(Date.parse(value.retrieved_at)) || !Number.isFinite(Date.parse(value.cutoff)) || Date.parse(value.retrieved_at) - Date.parse(value.cutoff) !== hours * 3600000 || !value.severity_distribution || typeof value.severity_distribution !== 'object' || Array.isArray(value.severity_distribution) || Object.values(value.severity_distribution).some(n => !count(n)) || Object.values(value.severity_distribution).reduce((a, b) => a + b, 0) !== value.total_events || !buckets(value.top_sources, 20) || !buckets(value.top_ports, 20) || !buckets(value.top_signatures, 10) || !Array.isArray(value.rule_findings) || value.rule_findings.length > 26 || value.rule_findings.some(row => !row || typeof row.title !== 'string' || typeof row.description !== 'string' || !['info', 'low', 'medium', 'high', 'critical'].includes(row.severity) || !Array.isArray(row.recommended_actions) || row.recommended_actions.some(text => typeof text !== 'string'))) throw new Error('Detection coverage did not match the selected window or aggregate counts. Refresh before relying on it.');
      setData(value);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Detection coverage could not be loaded.')); }).finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [open, hours, retry]);
  return <section aria-label="Read-only detection coverage preview" className="oa-panel space-y-3 p-4 sm:p-6">
    <div className="flex flex-wrap gap-2"><button type="button" className={control} aria-expanded={open} onClick={() => setOpen(value => !value)}>Preview detection coverage</button>{open && <label className="text-xs text-surface-300">Detection preview lookback<select className={`${control} ml-2`} value={hours} onChange={event => setHours(Number(event.target.value))}><option value={24}>24 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option></select></label>}</div>
    {open && <>
      <p className="text-xs text-surface-400">Read-only owned telemetry statistics and current rule candidates. No AI, ledger write, triage, case creation or action execution. Includes processed and already-linked events, unlike triage intake. Future-dated records are excluded. This separate lookback does not change the Run pipeline selector.</p>
      <button className={control} disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh detection coverage</button>
      {loading && <p role="status" className="text-sm text-surface-300">Loading current detection coverage...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loading && !error && data && <>
        <p className="break-all text-xs text-surface-400">Recorded-time window: {data.cutoff} through {data.retrieved_at}. Counts can change before a run; this is not a saved run result.</p>
        <dl className="grid gap-2 sm:grid-cols-3">{[[data.total_events, 'Owned events'], [data.alert_events, 'Alert-type events'], [data.rule_findings.length, 'Current rule candidates']].map(([n, label]) => <div key={label} className="rounded border border-surface-700 p-3"><dt className="text-xs text-surface-400">{label}</dt><dd className="text-xl font-semibold text-surface-100">{n}</dd></div>)}</dl>
        <p className="text-xs text-surface-300">AI eligibility: {data.ai_eligible ? 'Eligible under the current event-count rule. No AI was run and its findings or availability are not predicted.' : 'Not eligible under the current rule (more than 5 events and at least 1 alert-type event). This is not an all-clear.'}</p>
        <p className="break-words text-xs text-surface-300">Recorded severity counts: {Object.entries(data.severity_distribution).map(([label, n]) => `${label}: ${n}`).join(' · ') || 'No events in this window'}</p>
        <div className="grid gap-3 lg:grid-cols-3">{([['Sources', data.top_sources, 20], ['Destination ports', data.top_ports, 20], ['Signatures', data.top_signatures, 10]] as const).map(([label, rows, limit]) => <details key={label} className="min-w-0 rounded border border-surface-700 p-3 text-xs text-surface-300"><summary className="cursor-pointer">{label}: top {rows.length} of up to {limit} buckets</summary><p className="mt-2 text-surface-400">Counted here: {rows.reduce((sum, row) => sum + row.count, 0)} event occurrences. Top buckets only; missing values and values beyond this limit are not listed.</p><ol className="mt-2 space-y-1">{rows.map(row => <li key={row.label} className="break-words">{row.label || '(Empty saved value)'}: {row.count}</li>)}</ol></details>)}</div>
        <p className="text-xs text-surface-400">Rules use the top 20 sources and destination ports plus the severity distribution. AI, when eligible and run separately, receives top 10 sources, ports and signatures. Bucket counts do not establish source-to-port relationships or confirmed threats.</p>
        <h3 className="text-sm font-semibold text-surface-100">Rule candidates, not confirmed incidents</h3>
        {!data.rule_findings.length && <p className="text-sm text-surface-300">No current rule candidates. This does not establish that the telemetry is safe or that AI found no threats.</p>}
        <ol className="space-y-2">{data.rule_findings.map((row, index) => <li key={index} className="min-w-0 space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300"><p className="break-words font-semibold text-surface-100">{row.title} · {row.severity}</p><p className="break-words">{row.description}</p><p className="break-words">Suggested review: {row.recommended_actions.join('; ')}</p></li>)}</ol>
      </>}
    </>}
  </section>;
}
