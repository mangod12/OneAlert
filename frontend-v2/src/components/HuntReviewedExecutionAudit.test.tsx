import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import * as evidence from '../utils/huntEvidence';
import { reviewedAuditFixture } from '../utils/huntReviewedExecutionAudit.fixture';
import { HuntReviewedExecutionAudit } from './HuntReviewedExecutionAudit';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const show = () => { const fixture = reviewedAuditFixture(); return { ...fixture, ...render(<HuntReviewedExecutionAudit result={fixture.result} resultReadAt="2026-11-22T03:20:00Z" />) }; };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Audit exact reviewed draft' }));
beforeEach(() => vi.clearAllMocks()); afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('reads only the exact source on demand, matches selected original position 2, and links both exact contexts', async () => {
  const { source } = show(); expect(get).not.toHaveBeenCalled(); get.mockResolvedValueOnce({ data: source }); open();
  await screen.findByRole('heading', { name: 'Original draft query 2' });
  expect(get).toHaveBeenCalledExactlyOnceWith('/hunt/query-drafts/7'); expect(post).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Original draft query 1' })).toBeNull();
  expect(screen.getByText(/2 retained source queries were not selected/)).toBeTruthy();
  expect(screen.getByText(/1 rows retained, not confirmed threats/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open audited source draft #7' }).getAttribute('href')).toBe('/app/hunt?query_draft=7');
  expect(screen.getByRole('link', { name: 'Open audited saved result #81' }).getAttribute('href')).toBe('/app/hunt?session=81');
});
it.each(['source_changed', 'receipt_changed', 'missing', 'malformed'])('refuses unmatched or unavailable evidence with no source fallback: %s', async mode => {
  const { source, result } = show();
  if (mode === 'source_changed') source.fingerprint = 'b'.repeat(64);
  if (mode === 'receipt_changed') result.query_results![0].query!.sql = 'Changed';
  if (mode === 'missing') get.mockRejectedValueOnce({ response: { status: 404 } });
  else get.mockResolvedValueOnce({ data: mode === 'malformed' ? {} : source });
  open(); await screen.findByRole('alert'); expect(screen.queryByRole('article')).toBeNull(); expect(get).toHaveBeenCalledTimes(1); expect(post).not.toHaveBeenCalled();
});
it('clears a previously matched pair during refresh and after source drift', async () => {
  const { source } = show(); get.mockResolvedValueOnce({ data: source }); open(); await screen.findByRole('article');
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh exact reviewed-draft audit' })); expect(screen.queryByRole('article')).toBeNull();
  await act(async () => finish({ data: { ...source, fingerprint: 'c'.repeat(64) } })); await screen.findByRole('alert'); expect(screen.queryByRole('article')).toBeNull();
});
it('blocks duplicate reads and ignores late responses after close or unmount', async () => {
  const view = show(); let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  open(); fireEvent.click(screen.getByRole('button', { name: 'Refresh exact reviewed-draft audit' })); expect(get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close reviewed-draft audit' })); await act(async () => finish({ data: view.source })); expect(screen.queryByRole('article')).toBeNull();
  get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); open(); view.unmount(); await act(async () => finish({ data: view.source })); expect(screen.queryByRole('article')).toBeNull();
});
it('exports both loaded contexts and telemetry with no new reads, and handles download failure without losing the pair', async () => {
  const save = vi.spyOn(evidence, 'saveHuntDownload').mockImplementation(() => {}), { source, result } = show();
  get.mockResolvedValueOnce({ data: source }); open(); await screen.findByRole('article');
  const download = screen.getByRole('button', { name: 'Download loaded reviewed-draft audit JSON' }); fireEvent.click(download);
  const value = JSON.parse(save.mock.calls[0][0]); expect(value.source).toEqual(source); expect(value.result).toEqual(result); expect(value.result_read_at).toBe('2026-11-22T03:20:00Z'); expect(get).toHaveBeenCalledTimes(1);
  save.mockImplementation(() => { throw Error('Blocked'); }); fireEvent.click(download); await screen.findByRole('alert'); expect(screen.getByRole('article')).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1);
});
it('describes interruption without a complete receipt as unknown completion, never a zero-row success', async () => {
  const { source, result } = reviewedAuditFixture(); result.status = 'failed'; result.error = 'Interrupted'; delete result.query_results; delete result.execution_summary;
  render(<HuntReviewedExecutionAudit result={result} resultReadAt="2026-11-22T03:20:00Z" />); get.mockResolvedValueOnce({ data: source }); open();
  await screen.findByText(/Source identity matched, but the interrupted run/); expect(screen.queryByText(/rows retained, not confirmed threats/)).toBeNull();
});
it('rejects self-referencing source provenance before any read', async () => {
  const { result } = show(); result.reviewed_draft!.session_id = result.session_id!; open(); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it('does not offer source audit for legacy hunts without recorded reviewed-draft provenance', () => {
  const { result } = reviewedAuditFixture(); delete result.reviewed_draft; render(<HuntReviewedExecutionAudit result={result} resultReadAt="2026-11-22T03:20:00Z" />); expect(screen.queryByRole('button')).toBeNull(); expect(get).not.toHaveBeenCalled();
});
