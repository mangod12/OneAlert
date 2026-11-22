import { recordedEventFields, recordedEventFilter, recordedEventFilterLink } from '../utils/recordedEventFilter';
export function EventRecordedFieldLinks({ event }: { event: Record<string, unknown> }) {
  const available = recordedEventFields.flatMap(field => {
    try { const value = recordedEventFilter(field, event[field]); return value ? [value] : []; } catch { return []; }
  });
  if (!available.length) return null;
  return <section aria-label="Recorded label search handoff" className="min-w-0 max-w-[calc(100vw-5rem)] space-y-2 rounded border border-surface-700 p-3 sm:max-w-full">
    <h3 className="text-sm font-semibold text-surface-200">Follow a saved identity or label across sources</h3>
    <div className="flex flex-wrap gap-2">{available.map(({ field, value }) => <a key={field} href={recordedEventFilterLink(field, value)} className="max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Search exact recorded {field}</a>)}</div>
    <p className="text-xs text-surface-400">Uses only the clicked field's currently loaded text, not the raw payload, source restriction or time window. A label match does not verify a shared identity, incident or outcome. Links include the sensitive label in their address; keep private. They grant no access and do not preserve this read. No search runs until you open a link.</p>
  </section>;
}
