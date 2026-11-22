import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render as baseRender, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EvidenceNoteSourceIndex, type SourceIndexEntry } from './EvidenceNoteSourceIndex';

const reference = (kind = 'alert', id = 11, fingerprint = 'a'.repeat(64)) => ({ kind: 'reviewed_evidence_note', schema_version: 1, case_id: 7, record_kind: kind, record_id: id, record_fingerprint: fingerprint, reviewed_fingerprint: 'b'.repeat(64), record_snapshot: { label_at_review: 'Saved gateway source', label_truncated: false, severity: 'high', recorded_at: '2026-01-01T00:00:00Z', processing_label: 'acknowledged', raw_payload: 'PRIVATE_NESTED' }, private_data: 'PRIVATE_METADATA' });
const entry = (id: number, metadata: unknown = reference()): SourceIndexEntry => ({ id, timestamp: '2026-11-22T12:00:00Z', entry_type: 'note', source: 'human', content: `PRIVATE_NOTE_TEXT ${id}`, metadata_json: metadata });
const props = (entries: SourceIndexEntry[] = [entry(1)]) => ({ caseId: 7, entries, onSelect: vi.fn() });
let captured: Blob | null;
let clicked: string[];
beforeEach(() => {
  captured = null; clicked = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { captured = blob; return 'blob:index'; }), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = (element: ReactElement) => { const view = baseRender(element); const open = screen.queryByRole('button', { name: 'Explore saved source notes' }); if (open) fireEvent.click(open); return view; };
const panel = () => screen.getByRole('region', { name: 'Analyst source reference index' });
const exportBody = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Download all/ }));
  return JSON.parse(await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsText(captured!); }));
};
it('indexes distinct exact source identities and saved fingerprints, not note counts as evidence counts', () => {
  render(<EvidenceNoteSourceIndex {...props([entry(1), entry(2, reference('alert', 11, 'c'.repeat(64))), entry(3, reference('event', 11)), entry(4, reference('alert', 12))])} />);
  expect(screen.getByText('4 indexed notes across 3 distinct sources. Repeated notes are not additional source records.')).toBeTruthy();
  expect(screen.getByRole('option', { name: 'alert #11: 2 notes, 2 saved fingerprints' })).toBeTruthy();
  expect(screen.getByText(/Historical application references only/)).toBeTruthy();
  expect(screen.getByText(/Multiple saved fingerprints do not prove a sequence/)).toBeTruthy();
});
it('filters exact sources separately from local note and saved-label search', () => {
  render(<EvidenceNoteSourceIndex {...props([entry(1), entry(2, reference('event', 11)), { ...entry(3), content: 'Target investigation interpretation' }])} />);
  fireEvent.change(screen.getByLabelText('Exact saved source'), { target: { value: 'alert:11' } });
  fireEvent.change(screen.getByLabelText('Search loaded source notes'), { target: { value: 'target' } });
  expect(screen.getByText(/1 matching note across 1 source/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show note #3 in timeline' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show note #2 in timeline' })).toBeNull();
  fireEvent.click(screen.getByText('Clear source-note filters')); expect(screen.getByText(/3 matching notes across 2 sources/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search loaded source notes'), { target: { value: 'SAVED GATEWAY' } }); expect(within(panel()).getAllByRole('listitem')).toHaveLength(3);
});
it('opens only the selected exact timeline note without evidence links or reads', () => {
  const p = props([entry(91)]); render(<EvidenceNoteSourceIndex {...p} />); fireEvent.click(screen.getByText('Show note #91 in timeline')); expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(91); expect(within(panel()).queryByRole('link')).toBeNull();
});
it('paginates five notes but exports every matching reference without note/actor/private metadata or search text', async () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ ...entry(i + 1), content: 'PRIVATE_QUERY_NEEDLE PRIVATE_NOTE_TEXT', author_email: 'PRIVATE_AUTHOR' }));
  render(<EvidenceNoteSourceIndex {...props(entries)} />);
  expect(within(panel()).getAllByRole('listitem')).toHaveLength(5); fireEvent.click(screen.getByText('Next source notes')); expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search loaded source notes'), { target: { value: 'PRIVATE_QUERY_NEEDLE' } }); expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  fireEvent.click(screen.getByText('Next source notes')); const body = await exportBody();
  expect(body.references).toHaveLength(12); expect(body.matching_note_count).toBe(12); expect(body.indexed_note_count).toBe(12); expect(body.selection).toEqual({ source_kind: null, source_id: null, text_filter_applied: true }); expect(JSON.stringify(body)).not.toContain('PRIVATE_'); expect(clicked).toEqual(['case-7-loaded-source-references.json']);
});
it('exports the exact selected source and only matching references', async () => {
  render(<EvidenceNoteSourceIndex {...props([entry(1), entry(2, reference('event', 11))])} />); fireEvent.change(screen.getByLabelText('Exact saved source'), { target: { value: 'event:11' } }); const body = await exportBody(); expect(body.references.map((n: { note_id: number }) => n.note_id)).toEqual([2]); expect(body.selection).toEqual({ source_kind: 'event', source_id: 11, text_filter_applied: false });
});
it('does not broaden a vanished selected source to all sources on refresh', () => {
  const view = render(<EvidenceNoteSourceIndex {...props([entry(1), entry(2, reference('event', 21))])} />); fireEvent.change(screen.getByLabelText('Exact saved source'), { target: { value: 'alert:11' } }); view.rerender(<EvidenceNoteSourceIndex {...props([entry(2, reference('event', 21))])} />);
  expect(screen.getByLabelText('Exact saved source')).toHaveProperty('value', 'alert:11'); expect(screen.getByText(/No supported source notes match/)).toBeTruthy(); expect(screen.getByRole('button', { name: /Download all 0/ })).toHaveProperty('disabled', true); expect(screen.queryByText('Show note #2 in timeline')).toBeNull();
});
it('uses refreshed references and removes deleted notes from downloads', async () => {
  const view = render(<EvidenceNoteSourceIndex {...props([entry(1), entry(2)])} />); view.rerender(<EvidenceNoteSourceIndex {...props([entry(2, reference('event', 21, 'c'.repeat(64)))])} />); const body = await exportBody(); expect(body.references).toHaveLength(1); expect(body.references[0]).toMatchObject({ note_id: 2, source_kind: 'event', source_id: 21, saved_fingerprint: 'c'.repeat(64) });
});
it('resets filters and page on case change instead of showing prior-case references', () => {
  const view = render(<EvidenceNoteSourceIndex {...props(Array.from({ length: 7 }, (_, i) => entry(i + 1)))} />); fireEvent.click(screen.getByText('Next source notes')); fireEvent.change(screen.getByLabelText('Search loaded source notes'), { target: { value: 'PRIVATE' } }); view.rerender(<EvidenceNoteSourceIndex {...props([entry(8, { ...reference('event', 22), case_id: 8 })])} caseId={8} />); fireEvent.click(screen.getByRole('button', { name: 'Explore saved source notes' })); expect(screen.getByLabelText('Search loaded source notes')).toHaveProperty('value', ''); expect(screen.getByText('Show note #8 in timeline')).toBeTruthy(); expect(screen.queryByText(/Show note #1/)).toBeNull();
});
it('sorts known note timestamps newest first, ties by ID, unknown times last without fabricating time', async () => {
  render(<EvidenceNoteSourceIndex {...props([{ ...entry(5), timestamp: 'bad' }, { ...entry(4), timestamp: '2026-11-21T12:00:00Z' }, entry(2), entry(1)])} />); expect(within(panel()).getAllByRole('button', { name: /Show note/ }).map(button => button.textContent)).toEqual(['Show note #1 in timeline', 'Show note #2 in timeline', 'Show note #4 in timeline', 'Show note #5 in timeline']); expect(screen.getByText('Note time not recorded')).toBeTruthy(); const body = await exportBody(); expect(body.references[3].note_timestamp).toBeNull();
});
it.each([
  { schema_version: true }, { schema_version: 2 }, { case_id: 8 }, { record_id: 0 }, { record_id: 1.5 }, { record_id: Number.MAX_SAFE_INTEGER + 1 }, { record_kind: ['alert'] }, { record_fingerprint: 'private' }, { reviewed_fingerprint: 'bad' }, { record_snapshot: null }, { record_snapshot: { ...reference().record_snapshot, label_at_review: 'x'.repeat(501) } }, { record_snapshot: { ...reference().record_snapshot, recorded_at: 'bad' } }, { record_snapshot: { ...reference().record_snapshot, severity: {} } },
])('excludes unsupported saved references without inferring a source %#', change => {
  render(<EvidenceNoteSourceIndex {...props([entry(1, { ...reference(), ...change })])} />); expect(screen.getByText(/1 unsupported or ambiguous/)).toBeTruthy(); expect(within(panel()).queryByRole('listitem')).toBeNull(); expect(screen.getByRole('button', { name: /Download all 0/ })).toHaveProperty('disabled', true);
});
it.each([{ id: 0 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { entry_type: 'analysis' }, { source: 'agent' }])('excludes invalid note identity or non-human/non-note entries %#', change => {
  render(<EvidenceNoteSourceIndex {...props([{ ...entry(1), ...change }])} />); expect(screen.getByText(/1 unsupported or ambiguous/)).toBeTruthy(); expect(within(panel()).queryByRole('listitem')).toBeNull();
});
it('excludes every ambiguous duplicate note identity, even one in unrelated metadata', () => {
  render(<EvidenceNoteSourceIndex {...props([entry(1), entry(1), entry(2), entry(2, null), entry(3)])} />); expect(screen.getByText(/3 unsupported or ambiguous/)).toBeTruthy(); expect(within(panel()).getAllByRole('listitem')).toHaveLength(1); expect(screen.getByText('Show note #3 in timeline')).toBeTruthy();
});
it('renders source labels and note excerpts as inert bounded text', () => {
  render(<EvidenceNoteSourceIndex {...props([{ ...entry(1, { ...reference(), record_snapshot: { ...reference().record_snapshot, label_at_review: '<img src=x onerror=alert(1)>', label_truncated: true } }), content: '<script>unsafe</script>' + 'x'.repeat(300) }])} />); expect(screen.getByText(/<img src=x/)).toBeTruthy(); expect(screen.getByText(/\[note excerpt\]/).textContent!.length).toBeLessThan(260); expect(document.querySelector('img,script')).toBeNull();
});
it('fails download locally with no stale success or extra work', () => {
  vi.mocked(URL.createObjectURL).mockImplementation(() => { throw Error('private'); }); render(<EvidenceNoteSourceIndex {...props()} />); fireEvent.click(screen.getByRole('button', { name: /Download all/ })); expect(screen.getByRole('alert').textContent).toContain('No read or write'); expect(screen.getByRole('alert').textContent).not.toContain('private'); fireEvent.change(screen.getByLabelText('Search loaded source notes'), { target: { value: 'missing' } }); expect(screen.queryByRole('alert')).toBeNull();
});
it.each([{ entries: [] }, { entries: [entry(1, null)] }, { entries: [entry(1, { kind: 'other' })] }])('does not invent an index for unrelated timeline entries %#', ({ entries }) => {
  const view = render(<EvidenceNoteSourceIndex {...props(entries)} />); expect(view.container.textContent).toBe('');
});
it('revokes an exported temporary URL', async () => {
  vi.useFakeTimers(); render(<EvidenceNoteSourceIndex {...props()} />); fireEvent.click(screen.getByRole('button', { name: /Download all/ })); act(() => vi.advanceTimersByTime(1000)); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:index'); vi.useRealTimers();
});

it('starts collapsed, preserves local filters while hidden and never shows original source actions', () => {
  baseRender(<EvidenceNoteSourceIndex {...props()} />); expect(screen.queryByLabelText('Search loaded source notes')).toBeNull(); fireEvent.click(screen.getByText('Explore saved source notes')); fireEvent.change(screen.getByLabelText('Search loaded source notes'), { target: { value: 'PRIVATE' } }); fireEvent.click(screen.getByText('Hide source-note index')); expect(screen.queryByLabelText('Search loaded source notes')).toBeNull(); fireEvent.click(screen.getByText('Explore saved source notes')); expect(screen.getByLabelText('Search loaded source notes')).toHaveProperty('value', 'PRIVATE'); expect(screen.queryByText('Compare saved source with current evidence')).toBeNull();
});
