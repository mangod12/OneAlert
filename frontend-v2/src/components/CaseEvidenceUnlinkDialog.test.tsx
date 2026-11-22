import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseEvidenceUnlinkDialog } from './CaseEvidenceUnlinkDialog';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post), legacyDelete = vi.mocked(apiClient.delete);
const preview = { case: { id: 7, title: 'Saved gateway investigation', summary: 'Saved case summary', status: 'closed', severity: 'critical', due_date: '2026-01-02', closed_at: '2026-01-03T00:00:00Z' }, kind: 'event', record: { id: 21, label: 'Recorded authentication event', severity: 'high', recorded_at: '2026-01-01T00:00:00Z', processing_label: 'in_case' }, link_count: 2, other_owned_case_count: 1, record_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64) };
const result = { case_id: 7, kind: 'event', record_id: 21, unlinked: true, removed_link_rows: 2, reviewed_fingerprint: preview.reviewed_fingerprint };
const props = () => ({ caseId: 7, kind: 'event' as const, recordId: 21, onCancel: vi.fn(), onUnlinked: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: preview }); post.mockResolvedValue({ data: result }); }); afterEach(cleanup);
const remove = () => screen.getByRole('button', { name: 'Unlink reviewed evidence' });
const refresh = () => screen.getByRole('button', { name: 'Refresh exact unlink review' });
async function acknowledge() { await screen.findByLabelText('Reason for unlinking'); fireEvent.change(screen.getByLabelText('Reason for unlinking'), { target: { value: '  Recorded evidence belongs in another case  ' } }); fireEvent.click(screen.getByRole('checkbox')); }
it('reads the exact pair and preserves evidence/status/triage warnings without any automatic mutation', async () => {
  render(<CaseEvidenceUnlinkDialog {...props()} />); await screen.findByLabelText('Reason for unlinking'); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/evidence/event/21/unlink-preview'); expect(post).not.toHaveBeenCalled(); expect(legacyDelete).not.toHaveBeenCalled(); expect(remove()).toHaveProperty('disabled', true);
  expect(screen.getByText(/2 saved link rows/)).toBeTruthy(); expect(screen.getByText(/1 other owned investigations/)).toBeTruthy(); expect(screen.getByText(/does not automatically requeue/)).toBeTruthy(); expect(screen.getByText(/even when removing its highest-severity alert/)).toBeTruthy(); expect(screen.getByText(/People who can view the investigation may read it/)).toBeTruthy();
});
it('requires both a nonblank reason and acknowledgement, and reason edits clear consent', async () => {
  render(<CaseEvidenceUnlinkDialog {...props()} />); await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox')); expect(remove()).toHaveProperty('disabled', true); fireEvent.change(screen.getByLabelText('Reason for unlinking'), { target: { value: '  ' } }); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); fireEvent.click(screen.getByRole('checkbox')); expect(remove()).toHaveProperty('disabled', true); await acknowledge(); fireEvent.change(screen.getByLabelText('Reason for unlinking'), { target: { value: 'Changed reason' } }); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
});
it('posts only the reviewed pair, exact fingerprint and trimmed reason, then confirms the removed row count', async () => {
  const p = props(); render(<CaseEvidenceUnlinkDialog {...p} />); await acknowledge(); fireEvent.click(remove()); await waitFor(() => expect(p.onUnlinked).toHaveBeenCalledExactlyOnceWith(2)); expect(post).toHaveBeenCalledExactlyOnceWith('/cases/7/evidence/event/21/unlink', { reviewed_fingerprint: preview.reviewed_fingerprint, reason: 'Recorded evidence belongs in another case' }); expect(legacyDelete).not.toHaveBeenCalled();
});
it('supports alert relationships without implying alert status or case severity changes', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, kind: 'alert', record: { ...preview.record, id: 11, processing_label: 'acknowledged' } } }); post.mockResolvedValueOnce({ data: { ...result, kind: 'alert', record_id: 11 } }); const p = { ...props(), kind: 'alert' as const, recordId: 11 }; render(<CaseEvidenceUnlinkDialog {...p} />); await acknowledge(); expect(screen.getByText(/The alert status does not change/)).toBeTruthy(); fireEvent.click(remove()); await waitFor(() => expect(p.onUnlinked).toHaveBeenCalledOnce()); expect(post.mock.calls[0][0]).toBe('/cases/7/evidence/alert/11/unlink');
});
it('blocks duplicate submissions and Cancel/Escape while the unlink outcome is pending', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const p = props(); render(<CaseEvidenceUnlinkDialog {...p} />); await acknowledge(); const form = remove().closest('form')!; fireEvent.submit(form); fireEvent.submit(form); fireEvent.click(screen.getByRole('button', { name: 'Cancel and refresh case' })); fireEvent.keyDown(document, { key: 'Escape' }); expect(post).toHaveBeenCalledTimes(1); expect(p.onCancel).not.toHaveBeenCalled(); expect(refresh()).toHaveProperty('disabled', true); await act(async () => finish({ data: result })); expect(p.onUnlinked).toHaveBeenCalledOnce();
});
it('refresh clears consent while retaining the reason for a fresh decision', async () => {
  render(<CaseEvidenceUnlinkDialog {...props()} />); await acknowledge(); fireEvent.click(refresh()); await screen.findByRole('checkbox'); expect(screen.getByRole('checkbox')).toHaveProperty('checked', false); expect(screen.getByLabelText('Reason for unlinking')).toHaveProperty('value', '  Recorded evidence belongs in another case  '); expect(remove()).toHaveProperty('disabled', true); expect(post).not.toHaveBeenCalled();
});
it('an already-unlinked read offers no mutation and makes no absence claim about original evidence', async () => {
  get.mockResolvedValueOnce({ data: { ...preview, link_count: 0 } }); render(<CaseEvidenceUnlinkDialog {...props()} />); await screen.findByText(/This exact pair has no saved link/); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'Unlink reviewed evidence' })).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it.each([{ ...preview, case: { ...preview.case, id: 8 } }, { ...preview, kind: 'alert' }, { ...preview, record: { ...preview.record, id: 22 } }, { ...preview, link_count: -1 }, { ...preview, other_owned_case_count: 0.5 }, { ...preview, reviewed_fingerprint: 'bad' }, { ...preview, record_fingerprint: 'bad' }, { ...preview, record: { ...preview.record, recorded_at: 'bad' } }, { ...preview, case: { ...preview.case, summary: {} } }])('rejects mismatched or malformed unlink preview %#', async data => {
  get.mockResolvedValueOnce({ data }); render(<CaseEvidenceUnlinkDialog {...props()} />); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it.each([{ ...result, case_id: 8 }, { ...result, kind: 'alert' }, { ...result, record_id: 22 }, { ...result, unlinked: false }, { ...result, removed_link_rows: 1 }, { ...result, reviewed_fingerprint: 'c'.repeat(64) }])('unconfirmed response %# requires rereading the exact link and never retries', async data => {
  post.mockResolvedValueOnce({ data }); const p = props(); render(<CaseEvidenceUnlinkDialog {...p} />); await acknowledge(); fireEvent.click(remove()); await screen.findByRole('alert'); expect(screen.getByText(/No automatic retry was made/)).toBeTruthy(); expect(screen.queryByRole('checkbox')).toBeNull(); expect(p.onUnlinked).not.toHaveBeenCalled(); get.mockResolvedValueOnce({ data: { ...preview, link_count: 0 } }); fireEvent.click(refresh()); await screen.findByText(/This exact pair has no saved link/); expect(post).toHaveBeenCalledTimes(1);
});
it('a network failure keeps the reason but clears review and does not reflect private errors', async () => {
  post.mockRejectedValueOnce({ response: { data: { detail: 'PRIVATE_SERVER_CONTENT' } } }); render(<CaseEvidenceUnlinkDialog {...props()} />); await acknowledge(); fireEvent.click(remove()); await screen.findByRole('alert'); expect(document.body.textContent).not.toContain('PRIVATE_SERVER_CONTENT'); expect(screen.queryByRole('checkbox')).toBeNull(); fireEvent.click(refresh()); await screen.findByLabelText('Reason for unlinking'); expect(screen.getByLabelText('Reason for unlinking')).toHaveProperty('value', '  Recorded evidence belongs in another case  '); expect(post).toHaveBeenCalledTimes(1);
});
it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid exact ID %s before any read', async value => {
  render(<CaseEvidenceUnlinkDialog {...props()} recordId={value} />); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it('does not confirm or redirect after the dialog is unmounted during a mutation', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const p = props(), view = render(<CaseEvidenceUnlinkDialog {...p} />); await acknowledge(); fireEvent.click(remove()); view.unmount(); await act(async () => finish({ data: result })); expect(p.onUnlinked).not.toHaveBeenCalled();
});
it('changing exact pair ignores older reads and clears another record reason', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const p = props(), view = render(<CaseEvidenceUnlinkDialog {...p} />); get.mockResolvedValueOnce({ data: { ...preview, record: { ...preview.record, id: 22, label: 'New exact record' } } }); view.rerender(<CaseEvidenceUnlinkDialog {...p} recordId={22} />); await screen.findByText('event #22: New exact record'); await act(async () => finish({ data: preview })); expect(screen.queryByText('event #21: Recorded authentication event')).toBeNull(); expect(screen.getByLabelText('Reason for unlinking')).toHaveProperty('value', '');
});
