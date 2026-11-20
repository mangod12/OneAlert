import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ComplianceAssessmentReview } from './ComplianceAssessmentReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get), patch = vi.mocked(apiClient.patch);
const assessment = { id: 7, control_id: 3, status: 'partial', evidence_type: 'manual', evidence_detail: 'Saved review', assessed_at: '2026-11-20T09:00:00Z', assessed_by: 'operator' };
const review = { assessment, reviewed_fingerprint: 'a'.repeat(64) };
const control = { id: 3, control_id: 'PR.AC-1', title: 'Managed identities' };
const onSaved = vi.fn(), onClose = vi.fn();
const mount = (initialStatus?: string) => render(<ComplianceAssessmentReview id={7} control={control} initialStatus={initialStatus} onClose={onClose} onSaved={onSaved} />);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: review }); patch.mockResolvedValue({ data: assessment }); });
afterEach(cleanup);
it('reads the exact saved assessment before enabling writes', async () => {
  mount();
  expect(screen.getByRole('button', { name: 'Save reviewed assessment' })).toHaveProperty('disabled', true);
  await screen.findByText('Saved status: partial');
  expect(get).toHaveBeenCalledExactlyOnceWith('/compliance/assessments/7/review');
  expect(patch).not.toHaveBeenCalled();
});
it('sends the intended status and explicit cleared evidence with the reviewed fingerprint', async () => {
  patch.mockResolvedValue({ data: { ...assessment, status: 'compliant', evidence_type: null, evidence_detail: null } });
  mount('compliant'); await screen.findByText('Saved status: partial');
  fireEvent.change(screen.getByLabelText('Evidence type'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Details'), { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed assessment' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(patch).toHaveBeenCalledExactlyOnceWith('/compliance/assessments/7', { status: 'compliant', evidence_type: null, evidence_detail: null }, { params: { reviewed_fingerprint: review.reviewed_fingerprint } });
});
it('keeps the dialog and draft when a save conflicts and requires a reload', async () => {
  patch.mockRejectedValue(new Error('Assessment changed'));
  mount(); await screen.findByText('Saved status: partial');
  fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Retained draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed assessment' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Details')).toHaveProperty('value', 'Retained draft');
  expect(screen.getByRole('button', { name: 'Save reviewed assessment' })).toHaveProperty('disabled', true);
  get.mockResolvedValue({ data: { ...review, assessment: { ...assessment, evidence_detail: 'Current server evidence' }, reviewed_fingerprint: 'b'.repeat(64) } });
  fireEvent.click(screen.getByRole('button', { name: 'Reload review and discard draft' }));
  await waitFor(() => expect(screen.getByLabelText('Details')).toHaveProperty('value', 'Current server evidence'));
  expect(screen.queryByRole('alert')).toBeNull();
});
it.each([
  { ...assessment, id: 8 }, { ...assessment, control_id: 9 },
  { ...assessment, status: 'compliant' }, { ...assessment, evidence_type: null },
  { ...assessment, evidence_detail: 'Unexpected' },
])('fails closed on an unconfirmed save acknowledgement %#', async result => {
  patch.mockResolvedValue({ data: result });
  mount(); await screen.findByText('Saved status: partial');
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed assessment' }));
  await screen.findByRole('alert'); expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save reviewed assessment' })).toHaveProperty('disabled', true);
});
it('blocks Escape, cancel, reload, duplicate submits and edits during a pending save', async () => {
  let resolve!: (value: unknown) => void;
  patch.mockReturnValue(new Promise(r => { resolve = r; }));
  mount(); await screen.findByText('Saved status: partial');
  const save = screen.getByRole('button', { name: 'Save reviewed assessment' });
  fireEvent.click(save); fireEvent.click(save); fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).not.toHaveBeenCalled(); expect(patch).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Details')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Reload review and discard draft' })).toHaveProperty('disabled', true);
  await act(async () => resolve({ data: assessment })); expect(onSaved).toHaveBeenCalledTimes(1);
});
it('ignores a save result after unmount', async () => {
  let resolve!: (value: unknown) => void;
  patch.mockReturnValue(new Promise(r => { resolve = r; }));
  const view = mount(); await screen.findByText('Saved status: partial');
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed assessment' })); view.unmount();
  await act(async () => resolve({ data: assessment })); expect(onSaved).not.toHaveBeenCalled();
});
it.each([{ ...review, assessment: { ...assessment, id: 9 } }, { ...review, assessment: { ...assessment, control_id: 4 } }, { ...review, reviewed_fingerprint: '' }])('rejects a mismatched review %#', async data => {
  get.mockResolvedValue({ data }); mount(); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Save reviewed assessment' })).toHaveProperty('disabled', true);
});
it('allows retrying a failed read without sending writes', async () => {
  get.mockRejectedValueOnce(new Error('offline')); mount(); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Reload review and discard draft' }));
  await screen.findByText('Saved status: partial'); expect(patch).not.toHaveBeenCalled();
});
