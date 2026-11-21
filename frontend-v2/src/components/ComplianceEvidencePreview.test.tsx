import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ComplianceEvidencePreview } from './ComplianceEvidencePreview';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const lead = { control_record_id: 3, control_id: 'DE.CM-1', framework: 'NIST CSF', framework_version: '2.0', title: 'Monitoring', status: 'partial', evidence: '1/4 sensor records have recent heartbeats. Detection is not tested.', preserve_manual_review: false };
const preview = { measurement_mode: 'metadata_review_leads', observed_at: '2026-11-21T18:00:00Z', limitations: ['Counts are review leads, not proof.'], assessments: [lead], total: 1 };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: preview }); });
afterEach(cleanup);
it('requires successful read and explicit confirmation without writing on open', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ComplianceEvidencePreview onClose={vi.fn()} onSave={save} saving={false} />);
  await screen.findByText(lead.evidence);
  const button = screen.getByRole('button', { name: 'Save fresh review leads' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledWith('/compliance/assess/preview');
});
it.each([null, {}, { ...preview, total: 4 }, { ...preview, observed_at: 'bad' }, { ...preview, assessments: [{ ...lead, status: 'compliant' }] }, { ...preview, assessments: [lead, lead], total: 2 }, { ...preview, measurement_mode: 'control_test' }])('fails closed on invalid previews %#', async value => {
  get.mockResolvedValue({ data: value });
  render(<ComplianceEvidencePreview onClose={vi.fn()} onSave={vi.fn()} saving={false} />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Save fresh review leads' })).toBeNull();
});
it('retries reads and does not imply a save on preview failure', async () => {
  get.mockRejectedValueOnce(new Error('offline'));
  render(<ComplianceEvidencePreview onClose={vi.fn()} onSave={vi.fn()} saving={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry evidence preview' }));
  await screen.findByText(lead.evidence);
  expect(get).toHaveBeenCalledTimes(2);
});
it('shows protected manual review and disables save for empty catalogs', async () => {
  get.mockResolvedValue({ data: { ...preview, assessments: [{ ...lead, preserve_manual_review: true }] } });
  const { unmount } = render(<ComplianceEvidencePreview onClose={vi.fn()} onSave={vi.fn()} saving={false} />);
  await screen.findByText(/Keep latest manual review/); unmount();
  get.mockResolvedValue({ data: { ...preview, total: 0, assessments: [] } });
  render(<ComplianceEvidencePreview onClose={vi.fn()} onSave={vi.fn()} saving={false} />);
  await screen.findByText(/Nothing to save/);
  expect(screen.queryByRole('checkbox')).toBeNull();
});
it('ignores stale reads after close', async () => {
  let resolve!: (value: unknown) => void;
  get.mockImplementation(() => new Promise(done => { resolve = done; }) as never);
  const { unmount } = render(<ComplianceEvidencePreview onClose={vi.fn()} onSave={vi.fn()} saving={false} />);
  unmount(); resolve({ data: preview }); await Promise.resolve();
  expect(screen.queryByText(lead.evidence)).toBeNull();
});
it('guards double click while save is in flight', async () => {
  let resolve!: () => void;
  const save = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  render(<ComplianceEvidencePreview onClose={vi.fn()} onSave={save} saving={false} />);
  await screen.findByText(lead.evidence); fireEvent.click(screen.getByRole('checkbox'));
  const button = screen.getByRole('button', { name: 'Save fresh review leads' });
  fireEvent.click(button); fireEvent.click(button); expect(save).toHaveBeenCalledTimes(1); resolve();
});
