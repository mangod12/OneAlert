import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
export interface SourceSnapshot { label_at_review: string; label_truncated: boolean; severity: string | null; recorded_at: string | null; processing_label: string | null }
interface Props { caseId: number; noteId: number; kind: 'alert' | 'event'; recordId: number; savedFingerprint: string; savedSnapshot: SourceSnapshot }
interface Comparison { retrieved_at: string; source_available: boolean; current_fingerprint: string | null; current_snapshot: SourceSnapshot | null; revision_matches: boolean | null; changed_snapshot_fields: (keyof SourceSnapshot)[] | null; link_count: number | null }
const fields = ['label_at_review', 'label_truncated', 'severity', 'recorded_at', 'processing_label'] as const;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optional = (value: unknown): value is string | null => value === null || typeof value === 'string';
function snapshot(value: unknown): SourceSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (typeof s.label_at_review !== 'string' || s.label_at_review.length > 500 || typeof s.label_truncated !== 'boolean' || !optional(s.severity) || !optional(s.processing_label) || !optional(s.recorded_at) || (s.recorded_at !== null && !time(s.recorded_at))) return null;
  return { label_at_review: s.label_at_review, label_truncated: s.label_truncated, severity: s.severity, recorded_at: s.recorded_at, processing_label: s.processing_label };
}
const control = 'min-h-9 rounded border border-surface-600 px-3 py-2 text-left text-xs text-primary-300 disabled:opacity-40';
export function EvidenceNoteSourceComparison(props: Props) {
  return <ComparisonPanel key={`${props.caseId}:${props.noteId}:${props.kind}:${props.recordId}:${props.savedFingerprint}:${JSON.stringify(props.savedSnapshot)}`} {...props} />;
}
function ComparisonPanel({ caseId, noteId, kind, recordId, savedFingerprint, savedSnapshot }: Props) {
  const mounted = useRef(false), request = useRef(0), inFlight = useRef(false);
  const [comparison, setComparison] = useState<Comparison | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [downloadError, setDownloadError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current += 1; }; }, []);
  const clear = () => { request.current += 1; inFlight.current = false; setLoading(false); setComparison(null); setError(''); setDownloadError(''); };
  const load = async () => {
    if (inFlight.current) return;
    const version = ++request.current; setComparison(null); setError(''); setDownloadError('');
    if (!positive(caseId) || !positive(noteId) || !positive(recordId) || !['alert', 'event'].includes(kind) || !hash(savedFingerprint) || !snapshot(savedSnapshot)) { setError('Exact saved note and source identities are required. No read was sent.'); return; }
    inFlight.current = true; setLoading(true);
    try {
      const { data: d } = await apiClient.get(`/cases/${caseId}/notes/${noteId}/source-comparison`);
      if (!mounted.current || version !== request.current) return;
      const saved = snapshot(d?.saved_snapshot), current = snapshot(d?.current_snapshot);
      if (d?.schema_version !== 1 || d.case_id !== caseId || d.note_id !== noteId || d.kind !== kind || d.record_id !== recordId || d.saved_fingerprint !== savedFingerprint || !saved || fields.some(field => saved[field] !== savedSnapshot[field]) || !time(d.retrieved_at) || typeof d.source_available !== 'boolean') throw Error('Unconfirmed exact note/source');
      if (d.source_available) {
        if (!hash(d.current_fingerprint) || !current || typeof d.revision_matches !== 'boolean' || d.revision_matches !== (d.current_fingerprint === savedFingerprint) || !Number.isSafeInteger(d.link_count) || d.link_count < 0 || !Array.isArray(d.changed_snapshot_fields)) throw Error('Invalid current comparison');
        const changes = fields.filter(field => saved[field] !== current[field]);
        if (JSON.stringify(changes) !== JSON.stringify(d.changed_snapshot_fields)) throw Error('Unconfirmed field comparison');
        setComparison({ retrieved_at: d.retrieved_at, source_available: true, current_fingerprint: d.current_fingerprint, current_snapshot: current, revision_matches: d.revision_matches, changed_snapshot_fields: changes, link_count: d.link_count });
      } else {
        if (['current_fingerprint', 'current_snapshot', 'revision_matches', 'changed_snapshot_fields', 'link_count'].some(key => d[key] !== null)) throw Error('Unavailable state contains current facts');
        setComparison({ retrieved_at: d.retrieved_at, source_available: false, current_fingerprint: null, current_snapshot: null, revision_matches: null, changed_snapshot_fields: null, link_count: null });
      }
    } catch { if (mounted.current && version === request.current) setError('This exact saved reference and current owned source could not be compared. No deletion, unchanged revision or current link is inferred. Reload the investigation if its saved note reference changed.'); }
    finally { if (mounted.current && version === request.current) { inFlight.current = false; setLoading(false); } }
  };
  const download = () => {
    if (!comparison || loading || error) return; setDownloadError('');
    try {
      const safeSaved = snapshot(savedSnapshot);
      const body = { evidence_type: 'analyst_note_source_comparison', schema_version: 1, case_id: caseId, note_id: noteId, kind, record_id: recordId, saved_fingerprint: savedFingerprint, saved_snapshot: safeSaved, ...comparison, exported_at: new Date().toISOString(), export_scope: 'Only this loaded owner-scoped application comparison. Bounded source labels, identifiers and fingerprints are included; note text, actor identities and raw payloads are excluded. Not signed evidence or proof of unchanged history, current availability after this read, or correct analyst interpretation. Review the intended audience before sharing.' };
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })), link = document.createElement('a');
      link.href = url; link.download = `case-${caseId}-note-${noteId}-source-comparison.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('The loaded comparison could not be downloaded. No new read or write was sent.'); }
  };
  const describe = (s: SourceSnapshot) => <><p className="whitespace-pre-wrap">{s.label_at_review || 'Label not recorded'}{s.label_truncated ? ' [label excerpt, truncated at 500 characters]' : ''}</p><p>Severity {s.severity || 'not recorded'}</p><p>Recorded time {s.recorded_at || 'not recorded'}</p><p>{kind === 'alert' ? 'Alert status' : 'Event processing label'} {s.processing_label || 'not recorded'}</p></>;
  return <section aria-label={`Source comparison for note ${noteId}`} className="mt-3 space-y-3 border-t border-surface-700 pt-3 text-xs [overflow-wrap:anywhere]">
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={loading} onClick={() => void load()}>{loading ? 'Reading current source...' : comparison ? 'Refresh saved-source comparison' : 'Compare saved source with current evidence'}</button>{(loading || comparison || error) && <button type="button" className={control} onClick={clear}>Clear source comparison</button>}</div>
    <p className="text-surface-400">Explicit read only for investigation #{caseId}, note #{noteId}, {kind} #{recordId}. No evidence, note, link, case state or notification changes. Nothing is read automatically.</p>
    {loading && <p role="status">Reading the exact saved reference and current owned source...</p>}{error && <p role="alert" className="text-warning">{error}</p>}
    {comparison && !loading && <>
      <p className="text-surface-400">Read received {comparison.retrieved_at}. This is a new application read, not a reserved or signed snapshot. Sources can change after this read, and note text is not re-reviewed.</p>
      {!comparison.source_available ? <p role="status" className="rounded border border-warning/40 p-3 text-warning">The original source is unavailable to this account in this read. It may be missing or no longer owned. This is not proof of deletion. Current revision and link state are unknown; the saved reference is kept.</p> : <>
        <p role="status" className={`rounded border p-3 ${comparison.revision_matches && !comparison.changed_snapshot_fields?.length ? 'border-success/40 text-success' : 'border-warning/40 text-warning'}`}>{comparison.revision_matches ? comparison.changed_snapshot_fields?.length ? 'Fingerprints match but saved snapshot fields differ. The stored reference is inconsistent; no unchanged-source conclusion can be made.' : 'Saved and current record fingerprints match in this read. This does not prove unchanged history, authenticity or correct analyst interpretation.' : comparison.changed_snapshot_fields?.length ? 'The current record fingerprint differs from the saved source revision. Review the bounded field differences below.' : 'The current record fingerprint differs, but these bounded snapshot fields match. At least one other saved record field differs; raw payloads are not returned.'}</p>
        <p>{comparison.link_count ? `${comparison.link_count} saved link rows for this exact pair in this read. Duplicate rows are not distinct source records.` : 'No saved link for this exact pair in this read. The original source remains readable to your account.'}</p>
        <div className="grid gap-3 sm:grid-cols-2"><section aria-label="Saved source snapshot" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h4 className="font-semibold">Saved source snapshot</h4>{describe(savedSnapshot)}<code className="block break-all text-surface-400">{savedFingerprint}</code></section><section aria-label="Current owned source snapshot" className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><h4 className="font-semibold">Current owned source snapshot</h4>{describe(comparison.current_snapshot!)}<code className="block break-all text-surface-400">{comparison.current_fingerprint}</code></section></div>
        <p>Changed bounded fields: {comparison.changed_snapshot_fields?.length ? comparison.changed_snapshot_fields.map(field => ({ label_at_review: 'label excerpt', label_truncated: 'label truncation flag', severity: 'severity', recorded_at: 'recorded time', processing_label: 'processing/status label' })[field]).join(', ') : 'none in this read'}. Only these saved fields are compared visibly, not a full payload diff.</p>
      </>}
      <button type="button" className={control} onClick={download}>Download loaded source comparison JSON</button><p className="text-surface-400">Download includes saved/current bounded source labels, IDs and fingerprints, not note text, actor identities or raw payloads. Review its audience before sharing. No extra read is sent.</p>{downloadError && <p role="alert" className="text-warning">{downloadError}</p>}
    </>}
  </section>;
}
