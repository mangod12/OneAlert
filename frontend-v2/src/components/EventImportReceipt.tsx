import { EventImportPreviewComparison } from './EventImportPreviewComparison';
import { compareImportReceipt, importReceiptDownload } from '../utils/eventImportComparison';
import { useState } from 'react';

import { importResponseMetadata, reasonLabels, type ImportReceipt } from '../utils/eventImportReceipt';
const count = (value?: number) => typeof value === 'number' ? value.toLocaleString() : 'Not recorded';

export function EventImportReceipt({ receipt, onDismiss }: { receipt: ImportReceipt; onDismiss: () => void }) {
  const [downloadError, setDownloadError] = useState('');
  const result = importResponseMetadata(receipt.result);
  const comparison = compareImportReceipt(receipt);
  const download = () => {
    setDownloadError('');
    try {
      const url = URL.createObjectURL(new Blob([importReceiptDownload(receipt)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'event-import-receipt.json';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('The receipt could not be downloaded. Its recorded response is still shown below.'); }
  };
  return <section aria-label="Last event import response" className="oa-panel min-w-0 space-y-3 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-base font-semibold text-surface-100">Last import response</h2><p className="mt-1 break-all text-sm text-surface-300">{receipt.filename}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={download} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Download import receipt JSON</button><button type="button" onClick={onDismiss} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-300">Dismiss import response</button></div>
    </div>
    <p className="text-sm font-medium text-surface-100">{result.ingested === undefined ? 'Imported count was not recorded in this response.' : result.ingested === 0 ? 'No events were imported.' : result.skipped ? 'Import finished with skipped records.' : 'Import response received.'}</p>
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      {([['JSON records received', result.received], ['Events imported', result.ingested], ['Records skipped', result.skipped], ['Redacted values in imported records', result.redacted]] as const).map(([label,value]) => <div key={label}><dt className="text-xs text-surface-400">{label}</dt><dd className="mt-1 font-semibold text-surface-100">{count(value)}</dd></div>)}
    </dl>
    <p className="break-words text-xs text-surface-400">Selected parser: {receipt.parser}. Source ID: {result.source_id ?? 'Not recorded'}. Response received at {receipt.received_at}, not the events' observation time.</p>
    {result.skip_reasons && Object.keys(result.skip_reasons).length > 0 ? <ul aria-label="Recorded skip reasons" className="space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300">{Object.entries(result.skip_reasons).map(([reason,value]) => <li key={reason}>{reasonLabels[reason] ?? 'Other recorded reason'}: {count(value)}</li>)}</ul> : (result.skipped ?? 0) > 0 ? <p className="text-xs text-warning">Skip reasons were not recorded in this response.</p> : null}
    <p className="text-xs text-surface-400">This response is kept only for this page visit. Download it if needed. These are recorded response counters, not a live scan or independent confirmation of stored events. Re-uploading the same file can create duplicate events.</p>
    <EventImportPreviewComparison comparison={comparison} />
    {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
  </section>;
}
