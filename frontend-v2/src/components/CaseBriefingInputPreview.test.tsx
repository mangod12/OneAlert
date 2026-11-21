import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseBriefingInputPreview } from './CaseBriefingInputPreview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const zero = { linked: 0, available: 0, included: 0, omitted: 0, unavailable: 0, limit: 20 };
const data = { format: 'onealert-briefing-inputs', version: 1, case_id: 7, retrieved_at: '2026-11-21T20:00:00Z', excluded: 'Raw payloads, notes and tasks.', scope: { alert: zero, event: { ...zero, limit: 50, linked: 3, available: 2, included: 1, omitted: 1, unavailable: 1 } }, source_records: [{ key: 'case:7', kind: 'case', id: 7, title: '<b>Case metadata</b>', summary: 'A shortened recorded summary.', private_unknown: 'DO-NOT-DISPLAY' }, { key: 'event:8', kind: 'event', id: 8, label: 'Authentication event', severity: 'high', recorded_at: '2026-11-21T18:00:00Z' }] };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Read current briefing input excerpts' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data }); });
afterEach(cleanup);
it('reads current excerpts only on request without generating a draft and renders only known fields as text', async () => {
  render(<CaseBriefingInputPreview caseId={7} />); expect(get).not.toHaveBeenCalled(); open();
  await screen.findByText('Authentication event'); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/briefing-inputs');
  expect(screen.getByText('<b>Case metadata</b>').querySelector('b')).toBeNull(); expect(screen.queryByText('DO-NOT-DISPLAY')).toBeNull();
  expect(screen.getByText(/1 omitted by input limit; 1 unavailable/)).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
});
it.each([null, {}, { ...data, case_id: 8 }, { ...data, version: 2 }, { ...data, retrieved_at: 'bad' }, { ...data, source_records: [data.source_records[0], data.source_records[0]] }, { ...data, scope: { ...data.scope, alert: { ...zero, limit: 100 } } }])('fails closed for invalid preview %#', async value => {
  get.mockResolvedValue({ data: value }); render(<CaseBriefingInputPreview caseId={7} />); open(); await screen.findByRole('alert'); expect(screen.queryByText('Authentication event')).toBeNull();
});
it('ignores stale replies after case changes and allows explicit retry', async () => {
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CaseBriefingInputPreview caseId={7} />); open(); view.rerender(<CaseBriefingInputPreview caseId={8} />);
  await act(async () => finish({ data })); expect(screen.queryByText('Authentication event')).toBeNull();
  get.mockRejectedValueOnce(new Error('Offline')); open(); await screen.findByRole('alert');
  view.rerender(<CaseBriefingInputPreview caseId={7} />); open(); await screen.findByText('Authentication event');
});
