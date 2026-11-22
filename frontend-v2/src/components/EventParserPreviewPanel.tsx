import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { eventFilePreviewFingerprint, eventParserPreviewJson, parseEventParserPreview, type EventParserPreview } from '../utils/eventParserPreview';
import { reasonLabels } from '../utils/eventImportReceipt';

// The upload dialog keys this panel by file-selection version and parser. Its
// callbacks independently check that identity before accepting a late result.
export function EventParserPreviewPanel({ file, sourceType, records, disabled, onPreview, onBusy }: {
  file: File; sourceType: string; records: number; disabled: boolean;
  onPreview: (value: EventParserPreview | null) => void; onBusy: (value: boolean) => void;
}) {
  const [preview, setPreview] = useState<EventParserPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const version = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { version.current++; }, []);
  const request = async () => {
    if (disabled || inFlight.current) return;
    const current = ++version.current;
    inFlight.current = true; setBusy(true); onBusy(true); setPreview(null); onPreview(null); setError('');
    try {
      const fingerprint = await eventFilePreviewFingerprint(file, sourceType);
      if (current !== version.current) return;
      const form = new FormData(); form.append('file', file);
      const result = await apiClient.post('/events/upload/preview', form, { params: { source_type: sourceType }, headers: { 'Content-Type': 'multipart/form-data' } });
      if (current !== version.current) return;
      if (result.data?.success !== true) throw Error('Invalid preview response');
      const checked = parseEventParserPreview(result.data.data, { sourceType, fingerprint, byteSize: file.size, records });
      setPreview(checked); onPreview(checked);
    } catch {
      if (current === version.current) setError('Parser preview could not be verified. No import was requested. No raw server error is shown. Choose the file or parser again, or request another preview.');
    } finally {
      if (current === version.current) { inFlight.current = false; setBusy(false); onBusy(false); }
    }
  };
  const download = () => {
    if (!preview || busy || disabled) return;
    setError('');
    try {
      const url = URL.createObjectURL(new Blob([eventParserPreviewJson(preview, file.name, new Date().toISOString())], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'event-parser-preview.json';
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('The preview metadata could not be downloaded. The loaded counters remain below.'); }
  };
  return <section aria-label="Optional source-parser preview" className="min-w-0 space-y-3 rounded border border-surface-600 p-3 text-xs text-surface-300">
    <h3 className="font-semibold text-surface-100">Check parser acceptance before import</h3>
    <p>Optional. This sends the selected file to the application server. It runs the selected parser and redaction checks without creating sources or importing events. No provider or AI call.</p>
    <button type="button" onClick={() => void request()} disabled={disabled || busy} className="max-w-full whitespace-normal rounded border border-primary-600 px-3 py-2 text-primary-300 disabled:opacity-40">{busy ? 'Checking source parser...' : 'Preview source parser without importing'}</button>
    {busy && <p role="status">Preparing exact file fingerprint and checking parser counters. Upload is disabled until this preview finishes.</p>}
    {preview && <div aria-label="Loaded parser-preview counters" className="min-w-0 space-y-3">
      <p className="font-medium text-surface-100">{preview.accepted === 0 ? 'No records accepted by this parser. Change the file or parser before importing.' : 'Parser preview loaded. No events imported by this preview.'}</p>
      <dl className="grid grid-cols-2 gap-3">{([
        ['JSON records received', preview.received], ['Records accepted', preview.accepted],
        ['Records skipped', preview.skipped], ['Redacted values in accepted records', preview.redactions_in_accepted],
      ] as const).map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="mt-1 font-semibold text-surface-100">{value.toLocaleString()}</dd></div>)}</dl>
      <p className="break-all text-surface-400">Selected parser: {preview.source_type}. Preview read at {preview.previewed_at}. File/parser fingerprint: {preview.fingerprint}.</p>
      {preview.skipped > 0 && <ul aria-label="Preview skip reasons and parsed-record positions" className="space-y-2">{Object.entries(preview.skip_reasons).map(([reason, amount]) => <li key={reason}>{reasonLabels[reason]}: {amount.toLocaleString()}. Parsed-record positions: {preview.skipped_positions[reason].record_positions.join(', ')}. Additional positions omitted: {preview.skipped_positions[reason].omitted_positions.toLocaleString()}.</li>)}</ul>}
      <p className="text-surface-400">Positions are one-based JSON record positions, not NDJSON line numbers. Only the first ten positions per skip reason are listed. Counters include no raw or normalized values. Redactions count only accepted records.</p>
      <p className="text-warning">This is not an import receipt, database commit guarantee, duplicate check or threat conclusion. A later Upload is separate and can fail. Parser policies and database state can change. Reimporting can create duplicates.</p>
      <button type="button" onClick={download} disabled={disabled || busy} className="max-w-full whitespace-normal rounded border border-surface-600 px-3 py-2 text-primary-300 disabled:opacity-40">Download parser-preview metadata JSON</button>
      <p className="text-surface-400">The download contains only loaded metadata, not file bytes or event values. Filename, counts and fingerprint can still identify sensitive input. Keep private; downloaded copies have no application access controls. No extra read, upload or sharing.</p>
    </div>}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </section>;
}
