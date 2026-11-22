import { eventScopeKeys, eventScopeLink, type EventInvestigationScope } from '../utils/eventInvestigationScope';

const labels: Record<keyof EventInvestigationScope, string> = {
  version: 'Link format version', source_id: 'Recorded source ID', recorded_field: 'Exact recorded field', recorded_value: 'Exact recorded text',
  started_at: 'Event start, included', ended_before: 'Event end, excluded', severity: 'Severity', event_type: 'Event type', source_type: 'Sensor type',
  ip: 'Source or destination IP pattern', signature: 'Signature pattern', sort: 'List sort order',
};

export function EventScopeHandoff({ scope, hasDraft }: { scope: EventInvestigationScope; hasDraft: boolean }) {
  let href = '';
  try { href = eventScopeLink(scope); } catch { /* Keep current results, but never substitute a broader link. */ }
  return <section aria-label="Private applied event scope" className="oa-panel min-w-0 space-y-3 p-4">
    <h2 className="text-sm font-semibold text-surface-200">Reopen this applied event scope</h2>
    <p className="text-xs text-warning">Private link with all applied filters and list sort order. Sensitive source IDs, identities, search text and time bounds are in its address. Keep the link private.</p>
    {hasDraft && <p role="status" className="text-xs text-warning">Unapplied time or exact-field drafts are excluded. This link still uses the applied scope.</p>}
    <details className="text-xs text-surface-300">
      <summary className="cursor-pointer">Review every filter included in the link</summary>
      <p className="mt-3 text-surface-400">The link starts at page 1 and reads current records, not frozen results. Opening it grants no account access, shares nothing with another person and does not run a hunt, create an investigation or change events. A different signed-in account only sees its own permitted records. Empty results do not prove no activity.</p>
      <p className="mt-3 text-surface-400">Time bounds use event timestamps, with the end excluded. Exact recorded text preserves case and spaces. IP and signature keep the existing case-insensitive substring and % / _ wildcard behavior. Counts above remain global. CSV uses the same filters but its existing newest-first order and 10,000-row limit.</p>
      <dl className="mt-3 space-y-3">{eventScopeKeys.filter(key => key !== 'version').map(key => <div key={key} className="min-w-0"><dt className="font-medium text-surface-200">{labels[key]}</dt><dd className="whitespace-pre-wrap break-words text-surface-400 [overflow-wrap:anywhere]">{scope[key] || 'No filter'}</dd></div>)}</dl>
    </details>
    {href ? <a href={href} className="inline-block max-w-full break-words rounded border border-surface-600 px-3 py-2 text-sm text-primary-300">Open complete applied-scope event link</a> : <p role="alert" className="text-xs text-danger">A complete link could not be built from these filters. No broader link was substituted and current results were not changed. Use supported filters with text of at most 1,024 characters.</p>}
  </section>;
}
