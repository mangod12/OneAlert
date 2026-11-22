import { MAX_EVENT_FILE_BYTES, MAX_EVENT_FILE_RECORDS } from './eventFileReview';
import { reasonLabels } from './eventImportReceipt';
export const eventSourceParserLabels = { suricata: 'Suricata (EVE JSON)', zeek: 'Zeek (JSON logs)', windows_security: 'Windows Security (Winlogbeat JSON)', linux_journal: 'Linux journal (systemd JSON)' } as const;
export type EventSourceParser = keyof typeof eventSourceParserLabels;
export interface EventParserPreview {
  format: string; source_type: EventSourceParser; fingerprint: string; byte_size: number; previewed_at: string;
  received: number; accepted: number; skipped: number; redactions_in_accepted: number;
  skip_reasons: Record<string, number>;
  skipped_positions: Record<string, { record_positions: number[]; omitted_positions: number }>;
}
export interface EventPreviewBinding { sourceType: string; fingerprint: string; byteSize: number; records: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function parseEventParserPreview(value: unknown, expected: EventPreviewBinding): EventParserPreview {
  const invalid = (): never => { throw Error('The parser preview did not match the exact file bytes, parser, record count and complete bounded counters. No import was requested.'); };
  const data = value as EventParserPreview;
  if (!object(data) || data.format !== 'onealert_event_parser_preview_v1' || !Object.hasOwn(eventSourceParserLabels, data.source_type) || data.source_type !== expected.sourceType || typeof data.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(data.fingerprint) || data.fingerprint.length !== 64 || data.fingerprint !== expected.fingerprint || !count(data.byte_size) || data.byte_size < 1 || data.byte_size > MAX_EVENT_FILE_BYTES || data.byte_size !== expected.byteSize || !date(data.previewed_at) || !count(data.received) || data.received < 1 || data.received > MAX_EVENT_FILE_RECORDS || data.received !== expected.records || !count(data.accepted) || !count(data.skipped) || data.accepted + data.skipped !== data.received || !count(data.redactions_in_accepted) || (data.accepted === 0 && data.redactions_in_accepted !== 0) || !object(data.skip_reasons) || !object(data.skipped_positions)) invalid();
  const reasons: Record<string, number> = {}, positions: EventParserPreview['skipped_positions'] = {}, seen = new Set<number>();
  if (Object.keys(data.skipped_positions).length !== Object.keys(data.skip_reasons).length) invalid();
  for (const [reason, amount] of Object.entries(data.skip_reasons)) {
    if (!Object.hasOwn(reasonLabels, reason) || !count(amount) || amount < 1 || amount > data.skipped) invalid();
    const entries = data.skipped_positions[reason];
    if (!entries || !Array.isArray(entries.record_positions) || entries.record_positions.length !== Math.min(amount, 10) || !count(entries.omitted_positions) || entries.omitted_positions !== amount - entries.record_positions.length || entries.record_positions.some((position, index, values) => !Number.isInteger(position) || position < 1 || position > data.received || seen.has(position) || (index > 0 && position <= values[index - 1]))) invalid();
    entries.record_positions.forEach(position => seen.add(position)); reasons[reason] = amount;
    positions[reason] = { record_positions: [...entries.record_positions], omitted_positions: entries.omitted_positions };
  }
  if (Object.values(reasons).reduce((sum, value) => sum + value, 0) !== data.skipped) invalid();
  return { format: data.format, source_type: data.source_type, fingerprint: data.fingerprint, byte_size: data.byte_size, previewed_at: data.previewed_at, received: data.received, accepted: data.accepted, skipped: data.skipped, redactions_in_accepted: data.redactions_in_accepted, skip_reasons: reasons, skipped_positions: positions };
}
export async function eventFilePreviewFingerprint(file: File, sourceType: string): Promise<string> {
  if (!Object.hasOwn(eventSourceParserLabels, sourceType) || !count(file.size) || file.size < 1 || file.size > MAX_EVENT_FILE_BYTES) throw Error('Choose a bounded event file and a supported parser before requesting a preview.');
  let bytes: ArrayBuffer;
  try {
    bytes = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(Error('Unreadable file')); reader.onerror = () => reject(Error('Unreadable file')); reader.readAsArrayBuffer(file);
    });
    if (bytes.byteLength !== file.size) throw Error('Changed file');
    const prefix = new TextEncoder().encode(`onealert_event_parser_preview_v1\0${sourceType}\0`), bound = new Uint8Array(prefix.byteLength + bytes.byteLength);
    bound.set(prefix); bound.set(new Uint8Array(bytes), prefix.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', bound.buffer);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  } catch { throw Error('The selected file fingerprint could not be prepared. No preview or import was requested. Choose the file again or use a browser with secure hashing support.'); }
}
export function eventParserPreviewJson(preview: EventParserPreview, filename: string, exportedAt: string): string {
  if (typeof filename !== 'string' || Array.from(filename).length > 1024 || !date(exportedAt)) throw Error('Valid file metadata and export time are required.');
  const checked = parseEventParserPreview(preview, { sourceType: preview.source_type, fingerprint: preview.fingerprint, byteSize: preview.byte_size, records: preview.received });
  return JSON.stringify({ ...checked, filename, exported_at: exportedAt,
    scope: 'Loaded parser-preview metadata only, not imported events, a persistent import receipt, database commit guarantee, duplicate-detection check or threat conclusion. Only the first ten one-based parsed-record positions per reason are listed, not NDJSON line numbers; omitted-position counts remain explicit. No raw values, normalized payloads or file bytes. Filename, counts and file/parser fingerprint can still identify sensitive input. Keep private; downloaded copies have no application access controls. A later import is a separate explicit action and can fail. Parser policies and database state may change. Reimporting can create duplicate events. No extra read, upload, import or sharing.' }, null, 2) + '\n';
}
