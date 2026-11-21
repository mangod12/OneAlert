import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseBriefingCurrentSources } from './CaseBriefingCurrentSources';
import type { SavedBriefing } from '../utils/caseBriefingEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const zero = { linked: 0, available: 0, included: 0, omitted: 0, unavailable: 0, limit: 20 };
const scope = { alert: zero, event: { ...zero, limit: 50, linked: 2, available: 2, included: 2 } };
const row: SavedBriefing = { timeline_id: 11, briefing: { format: 'onealert-case-briefing', version: 1, case_id: 7, run_id: 83,
  mode: 'ai_draft', captured_at: '2026-11-21T18:00:00Z', scope,
  sources: [{ key: 'case:7', kind: 'case', id: 7, title: 'Saved case title' }, { key: 'event:8', kind: 'event', id: 8, label: 'Old event' }, { key: 'event:9', kind: 'event', id: 9, label: 'Saved only' }],
  observations: [{ text: 'Not a verified conclusion.', sources: ['case:7'] }], gaps: [], review_questions: [] } };
const data = { format: 'onealert-briefing-inputs', version: 1, case_id: 7, retrieved_at: '2026-11-22T00:00:00Z', excluded: 'Raw payloads, notes and tasks', scope,
  source_records: [row.briefing.sources[0], { key: 'event:8', kind: 'event', id: 8, label: '<b>Changed event</b>', unknown: 'DO-NOT-RENDER' }, { key: 'event:10', kind: 'event', id: 10, label: 'Current only' }] };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Compare saved inputs with current read' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data }); });
afterEach(cleanup);
it('compares the displayed saved excerpt with current inputs only on explicit click, without AI or writes', async () => {
  render(<CaseBriefingCurrentSources row={row} />); expect(get).not.toHaveBeenCalled(); open();
  await screen.findByRole('status'); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/briefing-inputs');
  expect(screen.getByRole('status').textContent).toContain('1 keys only in saved draft; 1 only in current read; 1 shared keys with different retained metadata; 1 with identical');
  expect(screen.getByText(/<b>Changed event/).querySelector('b')).toBeNull(); expect(screen.queryByText(/DO-NOT-RENDER/)).toBeNull();
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
});
it('treats source ordering and unrecognized fields as unchanged, without implying complete evidence', async () => {
  get.mockResolvedValue({ data: { ...data, source_records: [...row.briefing.sources].reverse().map(s => ({ ...s, private_unknown: 'DO-NOT-RENDER' })) } });
  render(<CaseBriefingCurrentSources row={row} />); open(); await screen.findByText(/No retained source differences/);
  expect(screen.getByRole('status').textContent).toContain('3 with identical retained metadata');
  expect(screen.getByText(/not a freshness guarantee/)).toBeTruthy(); expect(screen.queryByText(/DO-NOT-RENDER/)).toBeNull();
});
it.each([null, {}, { ...data, case_id: 8 }, { ...data, version: 2 }, { ...data, retrieved_at: 'invalid' }, { ...data, source_records: [data.source_records[0], data.source_records[0]] }, { ...data, scope: { ...scope, event: { ...scope.event, included: 49 } } }])('rejects unverified current input response %#', async value => {
  get.mockResolvedValue({ data: value }); render(<CaseBriefingCurrentSources row={row} />); open(); await screen.findByRole('alert'); expect(screen.queryByRole('status')).toBeNull();
});
it('rejects duplicate saved source keys before requesting current inputs', async () => {
  render(<CaseBriefingCurrentSources row={{ ...row, briefing: { ...row.briefing, sources: [...row.briefing.sources, row.briefing.sources[1]], scope: { ...scope, event: { ...scope.event, linked: 3, available: 3, included: 3 } } } }} />);
  open(); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it('clears a previous successful comparison on failed reread and supports explicit retry', async () => {
  render(<CaseBriefingCurrentSources row={row} />); open(); await screen.findByRole('status');
  get.mockRejectedValueOnce(new Error('Offline')); open(); await screen.findByRole('alert'); expect(screen.queryByRole('status')).toBeNull();
  open(); await screen.findByRole('status'); expect(get).toHaveBeenCalledTimes(3);
});
it('ignores stale replies after switching drafts or unmounting', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CaseBriefingCurrentSources row={row} />); open();
  view.rerender(<CaseBriefingCurrentSources row={{ ...row, timeline_id: 12 }} />);
  await act(async () => finish({ data })); expect(screen.queryByRole('status')).toBeNull();
  open(); await screen.findByRole('status'); view.unmount();
});
it('prevents duplicate requests while a current read is in flight', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CaseBriefingCurrentSources row={row} />); open(); fireEvent.click(screen.getByRole('button', { name: 'Reading current input differences...' }));
  expect(get).toHaveBeenCalledTimes(1); await act(async () => finish({ data })); await screen.findByRole('status');
});
