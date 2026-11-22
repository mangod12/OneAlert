import { useId, useState } from 'react';
import { importResponseMetadata, type ImportReceipt } from '../utils/eventImportReceipt';
import { EventSourceEvidence } from './EventSourceEvidence';

export function EventImportSourceReview({ receipt }: { receipt: ImportReceipt }) {
  // Object identity ties open tools to this response, even when two responses
  // have the same filename, parser, source ID and reported receive time.
  const toolsId = useId();
  const [openedReceipt, setOpenedReceipt] = useState<ImportReceipt | null>(null);
  const sourceId = importResponseMetadata(receipt.result).source_id;
  const usable = typeof sourceId === 'number' && sourceId > 0 && sourceId <= 2147483647;
  const opened = usable && openedReceipt === receipt;
  return <section aria-label="Post-import source investigation" className="min-w-0 space-y-3 rounded border border-surface-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Continue investigating the recorded source</h3>
    <p className="text-xs text-surface-400">The response reports a source ID, not an exact upload batch. Current source events can include earlier and later uploads. These tools do not independently prove this import committed, find duplicates or undo imported rows. Do not re-upload just to make counts match.</p>
    {usable ? <>
      <div className="flex min-w-0 flex-wrap gap-2">
        <a href={`/app/events?source_id=${sourceId}`} target="_blank" rel="noopener noreferrer" className="max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Open source #{sourceId} events in a new tab</a>
        <button type="button" aria-expanded={opened} aria-controls={toolsId} onClick={() => setOpenedReceipt(opened ? null : receipt)} className="max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">{opened ? 'Hide source investigation tools' : 'Show source investigation tools'}</button>
      </div>
      <p className="text-xs text-surface-400">The link opens only recorded source #{sourceId}, without this page's other filters, and keeps this response in the current tab. It grants no account access. Showing tools does not read data; use their explicit read buttons for the current retained profile, exact recorded-label events or observation-time timeline. All reads remain limited to your account.</p>
      <div id={toolsId} hidden={!opened}>{opened && <EventSourceEvidence key={sourceId} sourceId={sourceId} />}</div>
    </> : <p className="text-xs text-warning">No usable positive source ID was recorded. No source link or source read is offered. Do not guess a source from the filename, parser or response time.</p>}
  </section>;
}
