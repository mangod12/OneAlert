import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EvidenceAnalystHistory } from './EvidenceAnalystHistory';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import apiClient from '../api/client';
const get = vi.mocked(apiClient.get);
const props = { kind: 'event' as const, recordId: 21 };
const row = { note_id: 90, case_id: 7, case_title: 'PRIVATE_CASE_TITLE', case_title_truncated: false, case_status: 'closed', case_severity: 'high', note_timestamp: '2026-11-22T12:00:00Z', note_excerpt: 'PRIVATE_NOTE_TEXT', note_truncated: false, saved_fingerprint: 'a'.repeat(64), saved_label: 'Saved source label', label_truncated: false };
const result = { schema_version: 1, kind: 'event', record_id: 21, before: null, page_size: 20, scan_limit: 100, scanned_count: 1, excluded_count: 0, records: [row], has_more: false, next_before: null, retrieved_at: '2026-11-22T12:15:00Z', scope: 'PRIVATE_SCOPE', unknown: 'PRIVATE_EXTRA' };
const read = () => fireEvent.click(screen.getByRole('button', { name: /Read analyst source references|Refresh first analyst reference page/ }));
const loaded = () => screen.findByRole('link', { name: 'Open exact note #90 in investigation #7' });
let captured: Blob | null;
beforeEach(() => { vi.resetAllMocks(); captured = null; get.mockResolvedValue({ data: result }); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { captured = blob; return 'blob:history'; }), revokeObjectURL: vi.fn() })); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('only reads an exact owner-scoped source after explicit action and shows bounded historical interpretation with ID-only jump', async () => {
  render(<EvidenceAnalystHistory {...props} />); expect(get).not.toHaveBeenCalled(); read(); const link = await loaded(); expect(link.getAttribute('href')).toBe('/app/cases/7?note=90'); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/source-notes/event/21', { params: {} }); expect(screen.getByText(row.note_excerpt)).toBeTruthy(); expect(screen.getByText(/No full-history total is claimed/)).toBeTruthy(); expect(screen.getByText(/Saved references do not prove current links/)).toBeTruthy(); expect(document.body.textContent).not.toContain('PRIVATE_SCOPE'); expect(document.body.textContent).not.toContain('PRIVATE_EXTRA'); expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
it('supports exact alert identity without conflating it with an event of the same ID', async () => {
  get.mockResolvedValueOnce({ data: { ...result, kind: 'alert', record_id: 11 } }); render(<EvidenceAnalystHistory kind="alert" recordId={11} />); read(); await loaded(); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/source-notes/alert/11', { params: {} });
});
it('allows explicit continuation through an empty supported page without claiming absence', async () => {
  get.mockResolvedValueOnce({ data: { ...result, records: [], scanned_count: 100, excluded_count: 100, has_more: true, next_before: 100 } }).mockResolvedValueOnce({ data: { ...result, before: 100 } }); render(<EvidenceAnalystHistory {...props} />); read(); await screen.findByText(/No supported references in this candidate page/); expect(screen.getByText(/More candidates remain/)).toBeTruthy(); fireEvent.click(screen.getByText('Read next analyst reference page')); await loaded(); expect(get).toHaveBeenNthCalledWith(2, '/cases/source-notes/event/21', { params: { before: 100 } }); expect(screen.getByText(/Page 2: 1 supported references/)).toBeTruthy(); expect(screen.queryByText('Read next analyst reference page')).toBeNull(); read(); await loaded(); expect(get).toHaveBeenLastCalledWith('/cases/source-notes/event/21', { params: {} });
});
it('removes the old page and download immediately during refresh', async () => {
  render(<EvidenceAnalystHistory {...props} />); read(); await loaded(); let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); read(); expect(screen.queryByText(row.note_excerpt)).toBeNull(); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); fireEvent.click(screen.getByText('Reading analyst references...')); expect(get).toHaveBeenCalledTimes(2); await act(async () => finish({ data: result })); await loaded();
});
it('clear abandons a pending read and allows a new read without late resurrection', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); render(<EvidenceAnalystHistory {...props} />); read(); fireEvent.click(screen.getByText('Clear analyst references')); await act(async () => finish({ data: result })); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/Download/)).toBeNull(); read(); await loaded(); expect(get).toHaveBeenCalledTimes(2);
});
it('source changes reset loaded references and discard previous source replies', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<EvidenceAnalystHistory {...props} />); read(); view.rerender(<EvidenceAnalystHistory kind="alert" recordId={11} />); await act(async () => finish({ data: result })); expect(screen.queryByRole('link')).toBeNull(); expect(get).toHaveBeenCalledTimes(1); expect(screen.getByText(/exact alert #11/)).toBeTruthy();
});
it('unmounted components never restore a delayed page', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = render(<EvidenceAnalystHistory {...props} />); read(); view.unmount(); await act(async () => finish({ data: result })); expect(document.body.textContent).toBe('');
});
it('private failures remove old references and use a generic error without auto retry', async () => {
  render(<EvidenceAnalystHistory {...props} />); read(); await loaded(); get.mockRejectedValueOnce({ response: { data: { detail: 'PRIVATE_SERVER_CONTENT' } } }); read(); const error = await screen.findByRole('alert'); expect(error.textContent).toContain('No absence, deletion'); expect(document.body.textContent).not.toContain('PRIVATE_SERVER_CONTENT'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid exact source ID %s without a request', async recordId => {
  render(<EvidenceAnalystHistory kind="event" recordId={recordId} />); read(); expect((await screen.findByRole('alert')).textContent).toContain('No read was sent'); expect(get).not.toHaveBeenCalled();
});
it.each([
  { kind: 'alert' }, { record_id: 22 }, { schema_version: 2 }, { before: 1 }, { page_size: 21 }, { scan_limit: 101 }, { scanned_count: 101 }, { scanned_count: 0 }, { excluded_count: 1 }, { retrieved_at: 'bad' }, { has_more: 'yes' }, { has_more: true, next_before: null }, { has_more: true, next_before: 91 }, { next_before: 1 }, { records: [row, row], scanned_count: 2 }, { records: [{ ...row, note_id: 0 }] }, { records: [{ ...row, case_id: 1.5 }] }, { records: [{ ...row, case_title: 'x'.repeat(201) }] }, { records: [{ ...row, note_excerpt: 'x'.repeat(501) }] }, { records: [{ ...row, case_status: {} }] }, { records: [{ ...row, note_timestamp: 'bad' }] }, { records: [{ ...row, saved_label: 'x'.repeat(501) }] }, { records: [{ ...row, saved_fingerprint: 'bad' }] }, { records: [{ ...row, label_truncated: 1 }] },
])('rejects mismatched or malformed pages without empty-state claims or export %#', async change => {
  get.mockResolvedValueOnce({ data: { ...result, ...change } }); render(<EvidenceAnalystHistory {...props} />); read(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button', { name: /Download/ })).toBeNull(); expect(screen.queryByText(/No supported references in this candidate page/)).toBeNull();
});
it('rejects non-decreasing continuation cursors and notes outside the requested keyset', async () => {
  get.mockResolvedValueOnce({ data: { ...result, has_more: true, next_before: 90 } }).mockResolvedValueOnce({ data: { ...result, before: 90, records: [{ ...row, note_id: 89 }], has_more: true, next_before: 90 } }); render(<EvidenceAnalystHistory {...props} />); read(); await loaded(); fireEvent.click(screen.getByText('Read next analyst reference page')); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('renders untrusted note/title text inert, labels all excerpts and preserves unknown note time', async () => {
  get.mockResolvedValueOnce({ data: { ...result, records: [{ ...row, case_title: '<img src=x onerror=alert(1)>', note_excerpt: '<script>unsafe</script>', note_truncated: true, label_truncated: true, case_title_truncated: true, note_timestamp: null }] } }); render(<EvidenceAnalystHistory {...props} />); read(); await loaded(); expect(screen.getByText(/<img src=x/)).toBeTruthy(); expect(screen.getByText(/<script>unsafe/)).toBeTruthy(); expect(screen.getByText(/Note time not recorded/)).toBeTruthy(); expect(screen.getByText(/truncated at 500 characters/)).toBeTruthy(); expect(document.querySelector('img,script')).toBeNull();
});
it('exports only this loaded sanitized reference page, excluding interpretation, case context and all unknown nested fields without extra read', async () => {
  get.mockResolvedValueOnce({ data: { ...result, records: [{ ...row, actor: 'PRIVATE_ACTOR', nested: { data: 'PRIVATE_NESTED' } }] } }); render(<EvidenceAnalystHistory {...props} />); read(); await loaded(); fireEvent.click(screen.getByRole('button', { name: /Download this loaded/ }));
  const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsText(captured!); }); const body = JSON.parse(raw);
  expect(raw).not.toContain('PRIVATE_'); expect(body.references).toEqual([{ note_id: 90, case_id: 7, note_timestamp: row.note_timestamp, saved_fingerprint: row.saved_fingerprint, saved_label: row.saved_label, label_truncated: false }]); expect(body.kind).toBe('event'); expect(body.record_id).toBe(21); expect(body.page).toBe(1); expect(get).toHaveBeenCalledTimes(1); expect(body.export_scope).toContain('not all history');
});
it('reports a local download failure without exposing its private error or requesting again', async () => {
  vi.mocked(URL.createObjectURL).mockImplementation(() => { throw Error('PRIVATE_DOWNLOAD'); }); render(<EvidenceAnalystHistory {...props} />); read(); await loaded(); fireEvent.click(screen.getByRole('button', { name: /Download this loaded/ })); expect((await screen.findByRole('alert')).textContent).toContain('No new read or write'); expect(document.body.textContent).not.toContain('PRIVATE_DOWNLOAD'); expect(get).toHaveBeenCalledTimes(1);
});
