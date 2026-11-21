import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseBriefingComparison } from './CaseBriefingComparison';
import { compareBriefings } from '../utils/briefingComparison';
import type { SavedBriefing } from '../utils/caseBriefingEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const zero = { linked: 0, available: 0, included: 0, omitted: 0, unavailable: 0, limit: 20 };
const a: SavedBriefing = { timeline_id: 11, briefing: { format: 'onealert-case-briefing', version: 1, case_id: 7, run_id: 31, mode: 'ai_draft', captured_at: '2026-11-21T18:00:00Z', scope: { alert: zero, event: { ...zero, limit: 50, linked: 1, available: 1, included: 1 } }, sources: [{ key: 'case:7', kind: 'case', id: 7, title: 'Old case label' }, { key: 'event:8', kind: 'event', id: 8, label: 'First recorded event' }], observations: [{ text: 'An event was recorded.', sources: ['case:7', 'event:8'] }], gaps: ['Evidence remains incomplete.'], review_questions: [] } };
const b: SavedBriefing = { timeline_id: 12, briefing: { ...a.briefing, run_id: 32, captured_at: '2026-11-21T19:00:00Z', mode: 'recorded_metadata_fallback', sources: [{ key: 'case:7', kind: 'case', id: 7, title: 'Changed case label' }, { key: 'event:9', kind: 'event', id: 9, label: 'Different retained event' }], observations: [{ text: 'A different event was recorded.', sources: ['event:9'] }] } };
const response = (row: SavedBriefing) => ({ data: { case_id: 7, record: row, retrieved_at: '2026-11-21T19:05:00Z' } });
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => response(String(url).endsWith('/11') ? a : b)); });
afterEach(cleanup);
it('reads both exact IDs only with a pair and distinguishes retained evidence from real-world change', async () => {
  const view = render(<CaseBriefingComparison caseId={7} ids={[11]} />); expect(get).not.toHaveBeenCalled();
  view.rerender(<CaseBriefingComparison caseId={7} ids={[11, 12]} />);
  await screen.findByText(/1 source keys only in A; 1 only in B; 1 shared keys with different retained metadata/);
  expect(get).toHaveBeenCalledWith('/cases/7/briefing-drafts/11'); expect(get).toHaveBeenCalledWith('/cases/7/briefing-drafts/12');
  expect(screen.getByText(/not a changed conclusion/)).toBeTruthy(); expect(screen.getByText(/Metadata fallback/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open exact draft #11' }).getAttribute('href')).toBe('/app/cases/7?briefing=11');
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('compares exact text with source-key sets independently of citation order', () => {
  const changed = { ...b, briefing: { ...b.briefing, sources: a.briefing.sources, observations: [{ ...a.briefing.observations[0], sources: ['event:8', 'case:7'] }] } };
  const result = compareBriefings(a, changed); expect(result.shared).toBe(1); expect(result.onlyA).toEqual([]); expect(result.onlyB).toEqual([]);
  expect(result.sources.every(s => s.change === 'same')).toBe(true);
});
it('drops unknown server fields instead of exposing them in source differences', async () => {
  get.mockImplementation(async url => response(String(url).endsWith('/11') ? { ...a, briefing: { ...a.briefing, sources: a.briefing.sources.map(s => ({ ...s, private_unknown: 'NOT-FOR-DISPLAY' })) } } : b));
  render(<CaseBriefingComparison caseId={7} ids={[11, 12]} />);
  await screen.findByText(/1 source keys only in A/); fireEvent.click(screen.getByText('Inspect retained source differences'));
  expect(screen.queryByText(/NOT-FOR-DISPLAY/)).toBeNull(); expect(screen.getByText(/Old case label/)).toBeTruthy();
});
it.each([null, { case_id: 8, record: a, retrieved_at: '2026-11-21T19:05:00Z' }, { case_id: 7, record: { ...a, timeline_id: 99 }, retrieved_at: '2026-11-21T19:05:00Z' }, { case_id: 7, record: a, retrieved_at: 'bad' }, { case_id: 7, record: { ...a, briefing: { ...a.briefing, sources: [a.briefing.sources[0], a.briefing.sources[0]] } }, retrieved_at: '2026-11-21T19:05:00Z' }])('shows neither half when an exact read is invalid %#', async data => {
  get.mockResolvedValueOnce({ data }); render(<CaseBriefingComparison caseId={7} ids={[11, 12]} />);
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('retries both selected reads after a failed member without substituting history', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable'));
  render(<CaseBriefingComparison caseId={7} ids={[11, 12]} />); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry selected briefing comparison' })); await screen.findByRole('link', { name: 'Open exact draft #12' });
  expect(get).toHaveBeenCalledTimes(4);
});
it('ignores a late pair when selection changes or is cleared', async () => {
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CaseBriefingComparison caseId={7} ids={[11, 12]} />);
  view.rerender(<CaseBriefingComparison caseId={7} ids={[]} />);
  await act(async () => finish(response(a))); expect(screen.queryByRole('link')).toBeNull();
});
it.each([[11, 11], [0, 12], [-1, 12], [1.5, 12]])('does not fetch invalid pairs %j', (left, right) => {
  render(<CaseBriefingComparison caseId={7} ids={[left, right]} />); expect(get).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeTruthy();
});
