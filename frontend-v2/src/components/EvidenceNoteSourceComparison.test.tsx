import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { EvidenceNoteSourceComparison } from './EvidenceNoteSourceComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const savedSnapshot = { label_at_review: 'Saved gateway source', label_truncated: false, severity: 'high', recorded_at: '2026-01-01T00:00:00Z', processing_label: 'in_case' };
const props = { caseId: 7, noteId: 54, kind: 'event' as const, recordId: 21, savedFingerprint: 'a'.repeat(64), savedSnapshot };
const result = { schema_version: 1, case_id: 7, note_id: 54, kind: 'event', record_id: 21, saved_fingerprint: props.savedFingerprint, saved_snapshot: savedSnapshot, source_available: true, current_fingerprint: props.savedFingerprint, current_snapshot: savedSnapshot, revision_matches: true, changed_snapshot_fields: [], link_count: 2, retrieved_at: '2026-01-02T00:00:00Z' };
const unavailable = { ...result, source_available: false, current_fingerprint: null, current_snapshot: null, revision_matches: null, changed_snapshot_fields: null, link_count: null };
const load = async () => { render(<EvidenceNoteSourceComparison {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); await screen.findByRole('button', { name: 'Download loaded source comparison JSON' }); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: result }); }); afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('sends no automatic read or mutation and compares the exact saved note and original only on request', async () => {
  render(<EvidenceNoteSourceComparison {...props} />); expect(get).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); await screen.findByText(/fingerprints match in this read/); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/notes/54/source-comparison'); expect(screen.getByText(/2 saved link rows/)).toBeTruthy(); expect(screen.getByText(/does not prove unchanged history/)).toBeTruthy(); expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
it('shows saved/current bounded fields and a different revision without claiming a full raw-payload diff', async () => {
  get.mockResolvedValueOnce({ data: { ...result, current_fingerprint: 'b'.repeat(64), current_snapshot: { ...savedSnapshot, label_at_review: 'Changed label', severity: 'low' }, revision_matches: false, changed_snapshot_fields: ['label_at_review', 'severity'] } }); await load(); expect(screen.getByText('Changed label')).toBeTruthy(); expect(screen.getByText('Saved gateway source')).toBeTruthy(); expect(screen.getByText(/Changed bounded fields: label excerpt, severity/)).toBeTruthy(); expect(screen.getByText(/current record fingerprint differs from the saved source revision/)).toBeTruthy();
});
it('distinguishes changed non-snapshot fields from matching visible excerpts', async () => {
  get.mockResolvedValueOnce({ data: { ...result, current_fingerprint: 'b'.repeat(64), revision_matches: false } }); await load(); expect(screen.getByText(/At least one other saved record field differs/)).toBeTruthy(); expect(screen.getByText(/Changed bounded fields: none/)).toBeTruthy();
});
it('does not certify an inconsistent stored snapshot even if its recorded fingerprints match', async () => {
  get.mockResolvedValueOnce({ data: { ...result, current_snapshot: { ...savedSnapshot, severity: 'low' }, changed_snapshot_fields: ['severity'] } }); await load(); expect(screen.getByText(/stored reference is inconsistent/)).toBeTruthy(); expect(screen.queryByText(/fingerprints match in this read/)).toBeNull();
});
it('keeps an unlinked but owned source distinct from an unavailable source', async () => {
  get.mockResolvedValueOnce({ data: { ...result, link_count: 0 } }); await load(); expect(screen.getByText(/No saved link for this exact pair/)).toBeTruthy(); expect(screen.getByText(/original source remains readable/)).toBeTruthy();
});
it('unavailable means unknown current revision and links, never proof of deletion', async () => {
  get.mockResolvedValueOnce({ data: unavailable }); await load(); expect(screen.getByText(/This is not proof of deletion/)).toBeTruthy(); expect(screen.queryByLabelText('Current owned source snapshot')).toBeNull(); expect(screen.queryByText(/No saved link/)).toBeNull();
});
it('refresh clears a previous result and Clear discards a pending read without letting it restore stale state', async () => {
  await load(); let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); fireEvent.click(screen.getByRole('button', { name: 'Refresh saved-source comparison' })); expect(screen.queryByText(/fingerprints match in this read/)).toBeNull(); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Clear source comparison' })); await act(async () => finish({ data: result })); expect(screen.queryByText(/fingerprints match in this read/)).toBeNull(); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
});
it('invalidates a pending exact read when the note identity or saved reference changes', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<EvidenceNoteSourceComparison {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); view.rerender(<EvidenceNoteSourceComparison {...props} noteId={55} />); await act(async () => finish({ data: result })); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); expect(screen.getByText(/note #55/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1);
});
it('does not restore a comparison after unmount', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<EvidenceNoteSourceComparison {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); view.unmount(); await act(async () => finish({ data: result })); expect(document.body.textContent).toBe('');
});
it.each([{ ...result, schema_version: 2 }, { ...result, case_id: 8 }, { ...result, note_id: 55 }, { ...result, kind: 'alert' }, { ...result, record_id: 22 }, { ...result, saved_fingerprint: 'c'.repeat(64) }, { ...result, saved_snapshot: { ...savedSnapshot, severity: 'low' } }, { ...result, retrieved_at: 'bad' }, { ...result, source_available: 'true' }, { ...result, current_fingerprint: 'bad' }, { ...result, current_snapshot: null }, { ...result, revision_matches: false }, { ...result, changed_snapshot_fields: ['severity'] }, { ...result, link_count: -1 }, { ...result, link_count: 1.5 }, { ...unavailable, link_count: 0 }, { ...unavailable, changed_snapshot_fields: [] }])('rejects mismatched, incomplete or impossible comparison %# without inference or automatic retry', async data => {
  get.mockResolvedValueOnce({ data }); render(<EvidenceNoteSourceComparison {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); expect(screen.queryByText(/No saved link/)).toBeNull(); expect(get).toHaveBeenCalledTimes(1);
});
it('does not expose server errors or turn a private/read failure into an empty-source fact', async () => {
  get.mockRejectedValueOnce({ response: { data: { detail: 'PRIVATE_SERVER_CONTENT' } } }); render(<EvidenceNoteSourceComparison {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); await screen.findByRole('alert'); expect(document.body.textContent).not.toContain('PRIVATE_SERVER_CONTENT'); expect(screen.queryByText(/This is not proof of deletion/)).toBeNull(); expect(get).toHaveBeenCalledTimes(1);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid exact note ID %s before reading', async noteId => {
  render(<EvidenceNoteSourceComparison {...props} noteId={noteId} />); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it('downloads only a sanitized loaded comparison, stripping unknown payload/note/actor fields with no extra read', async () => {
  let blob: Blob | undefined; vi.stubGlobal('URL', { createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:comparison'; }), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  get.mockResolvedValueOnce({ data: { ...result, note_text: 'PRIVATE_NOTE', actor: 'PRIVATE_ACTOR', payload: 'PRIVATE_PAYLOAD', saved_snapshot: { ...savedSnapshot, secret: 'PRIVATE_NESTED' }, current_snapshot: { ...savedSnapshot, raw_data: 'PRIVATE_CURRENT_PAYLOAD' } } }); await load(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded source comparison JSON' }));
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); }); const body = JSON.parse(text); expect(text).not.toContain('PRIVATE_'); expect(body.case_id).toBe(7); expect(body.note_id).toBe(54); expect(body.saved_snapshot.label_at_review).toBe('Saved gateway source'); expect(body.current_snapshot.processing_label).toBe('in_case'); expect(body.export_scope).toContain('Not signed evidence'); expect(get).toHaveBeenCalledTimes(1); expect(apiClient.post).not.toHaveBeenCalled();
});
it('exports unknown current values honestly when source access is unavailable', async () => {
  let blob: Blob | undefined; vi.stubGlobal('URL', { createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:comparison'; }), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); get.mockResolvedValueOnce({ data: unavailable }); await load(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded source comparison JSON' })); const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); }); const body = JSON.parse(text); expect(body.source_available).toBe(false); expect(body.current_snapshot).toBeNull(); expect(body.link_count).toBeNull(); expect(body.changed_snapshot_fields).toBeNull(); expect(get).toHaveBeenCalledTimes(1);
});
it('reports download failure without sending a second read or a write', async () => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => { throw Error('Unavailable'); }), revokeObjectURL: vi.fn() }); await load(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded source comparison JSON' })); await screen.findByText(/could not be downloaded/); expect(get).toHaveBeenCalledTimes(1); expect(apiClient.post).not.toHaveBeenCalled();
});
