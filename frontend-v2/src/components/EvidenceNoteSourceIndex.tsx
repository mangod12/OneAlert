import { useMemo, useState } from 'react';
import { parseEvidenceNoteReference } from '../utils/evidenceNoteReference';

export interface SourceIndexEntry { id: number; timestamp: string; entry_type: string; source: string; content: string; metadata_json: unknown }
interface Props { caseId: number; entries: SourceIndexEntry[]; onSelect: (noteId: number) => void }
const control = 'min-h-9 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200';
const pageSize = 5;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const positive = (id: number) => Number.isSafeInteger(id) && id > 0;
export function EvidenceNoteSourceIndex(props: Props) {
  return <SourceIndex key={props.caseId} {...props} />;
}
function SourceIndex({ caseId, entries, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState(''), [source, setSource] = useState(''), [page, setPage] = useState(0), [downloadError, setDownloadError] = useState('');
  const prepared = useMemo(() => {
    const counts = new Map<number, number>();
    entries.forEach(entry => counts.set(entry.id, (counts.get(entry.id) || 0) + 1));
    const candidates = entries.filter(entry => entry.metadata_json && typeof entry.metadata_json === 'object' && (entry.metadata_json as Record<string, unknown>).kind === 'reviewed_evidence_note');
    const notes = candidates.flatMap(entry => {
      const reference = parseEvidenceNoteReference(entry.metadata_json, caseId);
      if (!positive(caseId) || !positive(entry.id) || counts.get(entry.id) !== 1 || entry.entry_type !== 'note' || entry.source !== 'human' || typeof entry.content !== 'string' || !reference) return [];
      const timestamp = typeof entry.timestamp === 'string' && entry.timestamp.length <= 64 && Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : null;
      return [{ id: entry.id, timestamp, content: entry.content, reference, sourceKey: `${reference.kind}:${reference.id}` }];
    }).sort((a, b) => (a.timestamp === null ? b.timestamp === null ? 0 : 1 : b.timestamp === null ? -1 : Date.parse(b.timestamp) - Date.parse(a.timestamp)) || a.id - b.id);
    const grouped = new Map<string, { key: string; kind: 'alert' | 'event'; id: number; count: number; fingerprints: Set<string> }>();
    for (const note of notes) {
      const group = grouped.get(note.sourceKey) || { key: note.sourceKey, kind: note.reference.kind, id: note.reference.id, count: 0, fingerprints: new Set<string>() };
      group.count += 1; group.fingerprints.add(note.reference.fingerprint); grouped.set(note.sourceKey, group);
    }
    const groups = [...grouped.values()].map(group => ({ key: group.key, kind: group.kind, id: group.id, count: group.count, revisions: group.fingerprints.size })).sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
    return { notes, groups, excluded: candidates.length - notes.length, candidates: candidates.length };
  }, [caseId, entries]);
  const selected = source;
  const needle = query.trim().toLowerCase();
  const matches = prepared.notes.filter(note => (!selected || note.sourceKey === selected) && (!needle || [note.content, note.reference.label, `${note.reference.kind} #${note.reference.id}`, String(note.id)].some(value => value.toLowerCase().includes(needle))));
  const pages = Math.max(1, Math.ceil(matches.length / pageSize)), current = Math.min(page, pages - 1), shown = matches.slice(current * pageSize, (current + 1) * pageSize);
  const clear = () => { setQuery(''); setSource(''); setPage(0); setDownloadError(''); };
  const download = () => {
    if (!matches.length) return;
    setDownloadError('');
    try {
      const body = { evidence_type: 'loaded_analyst_source_reference_index', schema_version: 1, case_id: caseId, exported_at: new Date().toISOString(), loaded_entry_count: entries.length, indexed_note_count: prepared.notes.length, excluded_reference_count: prepared.excluded, matching_note_count: matches.length, matching_source_count: new Set(matches.map(note => note.sourceKey)).size, selection: { source_kind: selected ? matches[0].reference.kind : null, source_id: selected ? matches[0].reference.id : null, text_filter_applied: !!needle }, references: matches.map(note => ({ note_id: note.id, note_timestamp: note.timestamp, source_kind: note.reference.kind, source_id: note.reference.id, saved_fingerprint: note.reference.fingerprint, saved_label: note.reference.label, label_truncated: note.reference.truncated })), export_scope: 'All matching references from the currently loaded timeline, not just this page. No extra read. Bounded saved labels, identifiers, timestamps and fingerprints only; note text, author identities, search text and unknown metadata excluded. Historical application references, not current evidence, current links, a complete archive, signed proof or confirmation of analyst interpretation. Multiple saved fingerprints do not prove a chronological change. Review the intended audience before sharing.' };
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })), link = document.createElement('a');
      link.href = url; link.download = `case-${caseId}-loaded-source-references.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('The loaded reference index could not be downloaded. No read or write was sent.'); }
  };
  if (!prepared.candidates) return null;
  return <section aria-label="Analyst source reference index" className="mb-5 min-w-0 space-y-3 rounded border border-primary-500/25 bg-primary-500/5 p-3 text-xs [overflow-wrap:anywhere]">
    <h3 className="text-sm font-semibold text-surface-100">Analyst source references</h3>
    <p className="text-surface-400">Find saved notes by exact source across this loaded timeline. Historical application references only, not current evidence or current links. No original source is read automatically.</p>
    <p>{plural(prepared.notes.length, 'indexed note')} across {plural(prepared.groups.length, 'distinct source')}. Repeated notes are not additional source records.</p>
    {prepared.excluded > 0 && <p className="text-warning">{prepared.excluded} unsupported or ambiguous saved references excluded. Nothing about their source or current availability is inferred.</p>}
    <button type="button" className={control} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide source-note index' : 'Explore saved source notes'}</button>
    {expanded && <><label className="block">Search loaded source notes<input aria-label="Search loaded source notes" type="search" maxLength={250} value={query} onChange={event => { setQuery(event.target.value); setPage(0); setDownloadError(''); }} placeholder="Note text, saved label, source or note ID" className={`${control} mt-1 w-full`} /></label>
    <div className="flex flex-wrap gap-2"><select aria-label="Exact saved source" value={selected} onChange={event => { setSource(event.target.value); setPage(0); setDownloadError(''); }} className={control}><option value="">All saved sources</option>{selected && !prepared.groups.some(group => group.key === selected) && <option value={selected}>Selected source no longer in the loaded index</option>}{prepared.groups.map(group => <option key={group.key} value={group.key}>{group.kind} #{group.id}: {plural(group.count, 'note')}, {plural(group.revisions, 'saved fingerprint')}</option>)}</select>{(query || selected) && <button type="button" onClick={clear} className={control}>Clear source-note filters</button>}</div>
    <p role="status">{plural(matches.length, 'matching note')} across {plural(new Set(matches.map(note => note.sourceKey)).size, 'source')}. Newest known note time first, then note ID. Multiple saved fingerprints do not prove a sequence of changes.</p>
    {shown.length ? <ul className="space-y-2">{shown.map(note => <li key={note.id} className="space-y-2 rounded border border-surface-700 p-3"><p className="font-semibold">{note.reference.kind} #{note.reference.id} · note #{note.id}</p><p className="text-surface-400">Note time {note.timestamp || 'not recorded'}</p><p className="whitespace-pre-wrap">{note.reference.label || 'Saved label not recorded'}{note.reference.truncated ? ' [saved label excerpt]' : ''}</p><p className="whitespace-pre-wrap text-surface-300">{note.content.slice(0, 240)}{note.content.length > 240 ? ' [note excerpt]' : ''}</p><button type="button" className={control} onClick={() => onSelect(note.id)}>Show note #{note.id} in timeline</button></li>)}</ul> : <p>No supported source notes match these filters. This is not a claim about all evidence or deleted notes.</p>}
    {pages > 1 && <div className="flex flex-wrap items-center gap-2"><button type="button" className={control} disabled={current === 0} onClick={() => setPage(current - 1)}>Previous source notes</button><span>Page {current + 1} of {pages}</span><button type="button" className={control} disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Next source notes</button></div>}
    <button type="button" className={`${control} disabled:opacity-40`} disabled={!matches.length} onClick={download}>Download all {plural(matches.length, 'matching source reference')} JSON</button><p className="text-surface-400">Download covers every matching reference, not just this page. Saved labels, IDs, fingerprints and note times are included; note text, authors and search text are excluded. Review its audience before sharing. No extra read or write is sent. Timeline filters and its full CSV export stay separate.</p>{downloadError && <p role="alert" className="text-warning">{downloadError}</p>}</>}
  </section>;
}
