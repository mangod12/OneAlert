import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { SuppressionDraftPreview } from './SuppressionDraftPreview';
vi.mock('../../api/client', () => ({ default: { post: vi.fn() } }));
const post = vi.mocked(apiClient.post), close = vi.fn();
const proposal = { name: 'Gateway scanner draft', title_contains: '100%_ check', duration_hours: 12 };
const snapshot = { proposal: { ...proposal, asset_id: null, cve_id: null, severity: null, enabled: true }, active_alert_count: 50, matching_alert_count: 23, example_limit: 10, previewed_at: 'now', examples: [{ id: 209, asset_id: 7, title: '100%_ check', severity: 'high', status: 'pending', cve_id: null }] };
beforeEach(() => { vi.resetAllMocks(); post.mockResolvedValue({ data: snapshot }); }); afterEach(cleanup);
it('shows a frozen read-only proposal and bounded examples with exact alert links', async () => {
  render(<SuppressionDraftPreview proposal={proposal} onClose={close} />); await screen.findByText('23 of 50 current active alerts match this draft.');
  expect(post).toHaveBeenCalledExactlyOnceWith('/suppression-rules/preview', proposal);
  expect(screen.getByRole('link', { name: 'Open exact example alert #209' }).getAttribute('href')).toBe('/app/alerts?alert=209');
  expect(screen.queryByRole('button', { name: /create/i })).toBeNull(); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
});
it.each([{ ...snapshot, proposal: { ...snapshot.proposal, duration_hours: 24 } }, { ...snapshot, proposal: { ...snapshot.proposal, enabled: false } }, { ...snapshot, active_alert_count: 0 }, { ...snapshot, examples: [{ ...snapshot.examples[0], id: 0 }] }])('rejects mismatched or malformed preview %#', async data => {
  post.mockResolvedValue({ data }); render(<SuppressionDraftPreview proposal={proposal} onClose={close} />); await screen.findByRole('alert'); expect(screen.queryByText('Alert #209: 100%_ check')).toBeNull();
});
it('does not label zero current matches as future safety', async () => {
  post.mockResolvedValue({ data: { ...snapshot, matching_alert_count: 0, examples: [] } }); render(<SuppressionDraftPreview proposal={proposal} onClose={close} />);
  await screen.findByText('No matches now does not make this rule safe for future alerts.');
});
it('clears old evidence on failed refresh and retries the same frozen proposal', async () => {
  render(<SuppressionDraftPreview proposal={proposal} onClose={close} />); await screen.findByText('Alert #209: 100%_ check'); post.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh draft scope' })); await screen.findByRole('alert'); expect(screen.queryByText('Alert #209: 100%_ check')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh draft scope' })); await screen.findByText('Alert #209: 100%_ check');
});
it('ignores stale results after a different proposal is previewed', async () => {
  let resolve!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<SuppressionDraftPreview proposal={proposal} onClose={close} />);
  const next = { ...proposal, title_contains: 'Different criteria' }; post.mockResolvedValueOnce({ data: { ...snapshot, proposal: { ...next, enabled: true }, matching_alert_count: 0, examples: [] } });
  view.rerender(<SuppressionDraftPreview proposal={next} onClose={close} />); await screen.findByText('No matches now does not make this rule safe for future alerts.'); await act(async () => resolve({ data: snapshot })); expect(screen.queryByText('Alert #209: 100%_ check')).toBeNull();
});
