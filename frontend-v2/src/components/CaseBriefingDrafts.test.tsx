import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseBriefingDrafts } from './CaseBriefingDrafts';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const row = { timeline_id: 11, briefing: { format: 'onealert-case-briefing', version: 1, case_id: 7, run_id: 83,
  mode: 'ai_draft', captured_at: '2026-11-21T18:00:00Z',
  scope: { alert: { linked: 3, available: 2, included: 0, omitted: 2, unavailable: 1, limit: 20 },
    event: { linked: 1, available: 1, included: 1, omitted: 0, unavailable: 0, limit: 50 } },
  sources: [{ key: 'case:7', kind: 'case', id: 7, title: 'Gateway case' }, { key: 'event:8', kind: 'event', id: 8, label: 'Recorded authentication event' }],
  observations: [{ text: 'An authentication event is recorded.', sources: ['event:8'] }],
  gaps: ['Metadata is not a complete investigation.'], review_questions: ['Does the original event need review?'] } };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: { case_id: 7, records: [row], next_before_id: null } }); post.mockResolvedValue({ data: { data: row } }); });
afterEach(cleanup);
const show = () => render(<CaseBriefingDrafts caseId={7} />);
const review = () => fireEvent.click(screen.getByRole('button', { name: 'Review briefing draft inputs' }));
const load = () => fireEvent.click(screen.getByRole('button', { name: 'Load latest saved briefing drafts' }));
it('does not call AI or read saved drafts until explicitly asked and requires input review to save', async () => {
  show(); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); review();
  const generate = screen.getByRole('button', { name: 'Generate and save briefing draft' });
  expect((generate as HTMLButtonElement).disabled).toBe(true); fireEvent.click(generate); expect(post).not.toHaveBeenCalled();
  expect(screen.getByText(/configured AI provider/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(generate);
  await screen.findByText(/Briefing draft #11/); expect(post).toHaveBeenCalledExactlyOnceWith('/cases/7/briefing-drafts');
  expect(screen.getByRole('link', { name: 'Inspect exact briefing run #83' }).getAttribute('href')).toBe('/app/audit-log?run=83');
  expect(screen.getAllByRole('link', { name: 'event #8' })[0].getAttribute('href')).toBe('/app/events/8');
});
it('loads saved source-linked evidence without generating or approving anything', async () => {
  show(); load(); await screen.findByText(/Briefing draft #11/); expect(post).not.toHaveBeenCalled();
  expect(screen.getByText(/0 included \/ 2 available/)).toBeTruthy();
  expect(screen.getByText('An authentication event is recorded.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
});
it('clearly identifies metadata-only fallback rather than a successful AI conclusion', async () => {
  get.mockResolvedValueOnce({ data: { case_id: 7, records: [{ ...row, briefing: { ...row.briefing, mode: 'recorded_metadata_fallback' } }], next_before_id: null } });
  show(); load(); expect(await screen.findByText(/AI unavailable or invalid: metadata-only fallback/)).toBeTruthy();
});
it.each([{ ...row, briefing: { ...row.briefing, case_id: 8 } }, { ...row, briefing: { ...row.briefing, run_id: 0 } },
  { ...row, briefing: { ...row.briefing, observations: [{ text: 'Invalid citation', sources: ['alert:999'] }] } },
  { ...row, briefing: { ...row.briefing, sources: [{ ...row.briefing.sources[0], title: {} }] } }])('rejects wrong case/run/reference or malformed input excerpts', async invalid => {
  get.mockResolvedValueOnce({ data: { case_id: 7, records: [invalid], next_before_id: null } }); show(); load();
  await screen.findByRole('alert'); expect(screen.queryByText(/Briefing draft #11/)).toBeNull(); expect(screen.queryByRole('link')).toBeNull();
});
it('keeps errors separate from an empty history and allows a fresh explicit read', async () => {
  get.mockRejectedValueOnce(new Error('History unavailable')); show(); load(); await screen.findByText('History unavailable');
  expect(screen.queryByText(/No saved briefing/)).toBeNull(); load(); await screen.findByText(/Briefing draft #11/);
});
it('clears and reads only the requested older page', async () => {
  get.mockResolvedValueOnce({ data: { case_id: 7, records: [row], next_before_id: 11 } }); show(); load(); await screen.findByText(/Briefing draft #11/);
  get.mockResolvedValueOnce({ data: { case_id: 7, records: [{ ...row, timeline_id: 10 }], next_before_id: null } });
  fireEvent.click(screen.getByRole('button', { name: 'Load older briefing drafts' })); await screen.findByText(/Briefing draft #10/);
  expect(screen.queryByText(/Briefing draft #11/)).toBeNull(); expect(get).toHaveBeenLastCalledWith('/cases/7/briefing-drafts', { params: { before_id: 11 } });
});
it('does not render a stale saved read after the visible case changes', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = show(); load(); view.rerender(<CaseBriefingDrafts caseId={8} />);
  await act(async () => finish({ data: { case_id: 7, records: [row], next_before_id: null } }));
  expect(screen.queryByText(/Briefing draft #11/)).toBeNull();
});
it('guards duplicate generation and warns that an uncertain POST may already have saved a draft', async () => {
  let fail!: (error: unknown) => void; post.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  show(); review(); fireEvent.click(screen.getByRole('checkbox')); const generate = screen.getByRole('button', { name: 'Generate and save briefing draft' });
  fireEvent.click(generate); fireEvent.click(generate); expect(post).toHaveBeenCalledTimes(1);
  await act(async () => fail({})); await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Load saved drafts before generating again'));
});
