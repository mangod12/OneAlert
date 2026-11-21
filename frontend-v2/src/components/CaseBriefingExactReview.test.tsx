import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseBriefingExactReview } from './CaseBriefingExactReview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { timeline_id: 11, briefing: { format: 'onealert-case-briefing', version: 1, case_id: 7, run_id: 83,
  mode: 'ai_draft', captured_at: '2026-11-21T18:00:00Z', scope: {
    alert: { linked: 0, available: 0, included: 0, omitted: 0, unavailable: 0, limit: 20 },
    event: { linked: 1, available: 1, included: 1, omitted: 0, unavailable: 0, limit: 50 } },
  sources: [{ key: 'case:7', kind: 'case', id: 7, title: 'Saved case title' }, { key: 'event:8', kind: 'event', id: 8, label: 'Saved event label' }],
  observations: [{ text: 'Recorded source metadata, not a verified conclusion.', sources: ['event:8'] }], gaps: [], review_questions: ['Is more evidence needed?'] } };
const response = { data: { case_id: 7, record: row, retrieved_at: '2026-11-21T18:05:00Z' } };
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>; }
const show = (query = '?briefing=11', canOpen: boolean | null = true) => render(<MemoryRouter initialEntries={[`/app/cases/7${query}`]}><CaseBriefingExactReview caseId={7} canOpen={canOpen} /><Location /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue(response); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('opens the exact older draft without a history-page lookup or AI generation', async () => {
  show(); await screen.findByText(/Briefing draft #11/);
  expect(get).toHaveBeenCalledExactlyOnceWith('/cases/7/briefing-drafts/11'); expect(apiClient.post).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Inspect exact briefing run #83' }).getAttribute('href')).toBe('/app/audit-log?run=83');
});
it.each(['?briefing=0', '?briefing=-1', '?briefing=1.5', '?briefing=11&briefing=12', '?briefing=9007199254740992', '?briefing='])('does not read an ambiguous or invalid link %s', query => {
  show(query); expect(screen.getByRole('alert').textContent).toContain('Invalid briefing link'); expect(get).not.toHaveBeenCalled();
});
it('does not fetch without a parameter or without confirmed owner access', () => {
  const view = show('', true); expect(get).not.toHaveBeenCalled(); view.unmount();
  show('?briefing=11', false); expect(screen.getByRole('alert').textContent).toContain('investigation owner'); expect(get).not.toHaveBeenCalled();
});
it('copies only this case/draft locator and closes without deleting unrelated params or fragment', async () => {
  show('?briefing=11&note=4#private-fragment'); await screen.findByText(/Briefing draft #11/);
  fireEvent.click(screen.getByRole('button', { name: 'Copy exact briefing link' })); await screen.findByText(/Exact briefing link copied/);
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/app/cases/7?briefing=11`);
  fireEvent.click(screen.getByRole('button', { name: 'Close exact briefing' }));
  expect(screen.getByTestId('location').textContent).toBe('/app/cases/7?note=4#private-fragment');
});
it('does not replace a failed exact lookup with a latest draft and retries only the same read', async () => {
  get.mockRejectedValueOnce(new Error('Draft unavailable')); show(); await screen.findByText('Draft unavailable');
  expect(screen.queryByText(/Briefing draft #11/)).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Retry exact briefing read' }));
  await screen.findByText(/Briefing draft #11/); expect(get).toHaveBeenLastCalledWith('/cases/7/briefing-drafts/11');
});
it('rejects a mismatched draft ID and never enables download for it', async () => {
  get.mockResolvedValue({ data: { ...response.data, record: { ...row, timeline_id: 12 } } }); show(); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /Download displayed/ })).toBeNull();
});
it('downloads this displayed saved read with explicit scope and no unexpected server fields or new fetch', async () => {
  const enriched = { ...row, hidden_token: 'DO-NOT-EXPORT', briefing: { ...row.briefing, hidden_token: 'DO-NOT-EXPORT' } };
  get.mockResolvedValue({ data: { ...response.data, record: enriched } }); let blob!: Blob;
  vi.stubGlobal('URL', class extends URL { static createObjectURL(value: Blob) { blob = value; return 'blob:briefing'; } static revokeObjectURL = vi.fn(); });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  show(); await screen.findByText(/Briefing draft #11/); fireEvent.click(screen.getByRole('button', { name: 'Download displayed briefing evidence (JSON)' }));
  await screen.findByText(/Briefing evidence download prepared/);
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
  const payload = JSON.parse(text); expect(payload.record.timeline_id).toBe(11); expect(payload.record.briefing).toEqual(row.briefing);
  expect(payload.read_at).toBe(response.data.retrieved_at); expect(payload.scope).toContain('Not refreshed source records'); expect(text).not.toContain('DO-NOT-EXPORT');
  expect(click).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1); expect(apiClient.post).not.toHaveBeenCalled();
});
it('ignores an obsolete read after the visible case changes', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = show(); view.rerender(<MemoryRouter><CaseBriefingExactReview caseId={8} canOpen /></MemoryRouter>);
  await act(async () => finish(response)); await waitFor(() => expect(screen.queryByText(/Briefing draft #11/)).toBeNull());
});
