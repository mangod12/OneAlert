import { importResponseMetadata, reasonLabels, type ImportReceipt } from './eventImportReceipt';
import { parseEventParserPreview, type EventParserPreview } from './eventParserPreview';
import { MAX_EVENT_FILE_RECORDS } from './eventFileReview';

export interface ImportComparisonRow { key: string; label: string; preview: number; actual?: number; delta?: number }
export interface ImportPreviewComparison {
  status: 'not_attached' | 'unverifiable' | 'incomplete' | 'different' | 'matching';
  preview: EventParserPreview | null;
  counters: ImportComparisonRow[];
  reasons: ImportComparisonRow[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

// Snapshot before the request, so later UI edits cannot change attached context.
// The server, not this copy, checks its fingerprint against submitted file bytes.
export function snapshotImportPreview(value: EventParserPreview | undefined, file: File, parser: string): EventParserPreview | undefined {
  if (value === undefined) return undefined;
  const snapshot = parseEventParserPreview(value, { sourceType: parser, fingerprint: value.fingerprint, byteSize: file.size, records: value.received });
  if (snapshot.accepted === 0) throw new Error('The attached preview accepted no records. No import was requested.');
  return snapshot;
}

export function compareImportPreview(value: unknown, parser: string, actual: unknown): ImportPreviewComparison {
  const result: ImportPreviewComparison = { status: value === undefined ? 'not_attached' : 'unverifiable', preview: null, counters: [], reasons: [] };
  if (value === undefined || !object(value)) return result;
  let preview: EventParserPreview;
  try {
    preview = parseEventParserPreview(value, { sourceType: parser, fingerprint: value.fingerprint as string, byteSize: value.byte_size as number, records: value.received as number });
  } catch { return result; }
  result.preview = preview;
  const saved = importResponseMetadata(actual);
  result.counters = ([['received', 'JSON records received', preview.received], ['ingested', 'Accepted / imported records', preview.accepted], ['skipped', 'Skipped records', preview.skipped], ['redacted', 'Redactions in accepted / imported records', preview.redactions_in_accepted]] as const).map(([key, label, expected]) => {
    const count = saved[key]; return { key, label, preview: expected, ...(count === undefined ? {} : { actual: count, delta: count - expected }) };
  });
  const completeCounters = result.counters.every(row => row.actual !== undefined);
  const received = saved.received, ingested = saved.ingested, skipped = saved.skipped;
  if ((received !== undefined && received > MAX_EVENT_FILE_RECORDS) || (ingested !== undefined && ingested > MAX_EVENT_FILE_RECORDS) || (skipped !== undefined && skipped > MAX_EVENT_FILE_RECORDS) || (received !== undefined && ingested !== undefined && skipped !== undefined && ingested + skipped !== received)) return result;
  const reasons = object(actual) ? actual.skip_reasons : undefined;
  if (reasons === undefined) { result.status = 'incomplete'; return result; }
  if (!object(reasons) || Object.entries(reasons).some(([key, amount]) => !Object.hasOwn(reasonLabels, key) || !number(amount))) return result;
  const reasonTotal = Object.values(reasons).reduce<number>((sum, amount) => sum + Number(amount), 0);
  if (!Number.isSafeInteger(reasonTotal) || (skipped !== undefined && reasonTotal !== skipped)) return result;
  result.reasons = [...new Set([...Object.keys(preview.skip_reasons), ...Object.keys(reasons)])].sort().map(key => ({ key, label: reasonLabels[key], preview: preview.skip_reasons[key] ?? 0, actual: reasons[key] === undefined ? 0 : Number(reasons[key]), delta: Number(reasons[key] ?? 0) - (preview.skip_reasons[key] ?? 0) }));
  if (!completeCounters) result.status = 'incomplete';
  else result.status = [...result.counters, ...result.reasons].some(row => row.delta !== 0) ? 'different' : 'matching';
  return result;
}

export function compareImportReceipt(receipt: ImportReceipt): ImportPreviewComparison {
  const comparison = compareImportPreview(receipt.parser_preview, receipt.parser, receipt.result);
  // Preserve rejection of raw reason metadata before unknown fields were removed.
  if (receipt.preview_response_unverifiable === true && comparison.status !== 'not_attached') comparison.status = 'unverifiable';
  return comparison;
}

export function importReceiptDownload(receipt: ImportReceipt): string {
  const comparison = compareImportReceipt(receipt);
  return JSON.stringify({ format: 'onealert_event_import_receipt_v1', scope: 'Last import response from this browser visit. No raw event values or file bytes included. Not a live check, persistent import history or duplicate-detection guarantee. Filename, source ID, counters and any attached file fingerprint can identify sensitive input. Keep private; downloaded copies have no application access controls. No extra read, upload, import or sharing.', filename: receipt.filename, parser: receipt.parser, received_at: receipt.received_at, result: importResponseMetadata(receipt.result),
    ...(comparison.status === 'not_attached' ? {} : { preview_comparison: { format: 'onealert_event_import_preview_comparison_v1', status: comparison.status, attached_request_preview: comparison.preview, counters: comparison.counters, reasons: comparison.reasons, scope: 'Loaded preview attached to this submitted request compared with its recorded import-response counters. Not an independently authenticated receipt, guarantee of unchanged parser policy, live event check, detection conclusion or reason to retry an import. Missing counters are not zero. Differences do not undo imported rows; inspect existing events before any retry.' } }),
  }, null, 2) + '\n';
}
