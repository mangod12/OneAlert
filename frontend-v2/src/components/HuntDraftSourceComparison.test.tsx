import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import * as evidence from '../utils/huntEvidence';
import { draftSourceFixture } from '../utils/huntDraftSourceComparison.fixture';
import { HuntDraftSourceComparison } from './HuntDraftSourceComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const show = (disabled = false) => { const fixture = draftSourceFixture(); return { ...fixture, ...render(<HuntDraftSourceComparison refined={fixture.refined} disabled={disabled} />) }; };
const read = () => fireEvent.click(screen.getByRole('button', { name: 'Compare with recorded source' }));
beforeEach(() => vi.clearAllMocks()); afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('reads only the exact recorded source on an explicit click, never on mount and never a query/action endpoint', async () => {
  const { source } = show(); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  get.mockResolvedValueOnce({ data: source }); read();
  await screen.findByRole('heading', { name: 'Original query 1: analyst-edited' });
  expect(get).toHaveBeenCalledExactlyOnceWith('/hunt/query-drafts/7'); expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Open compared source draft #7' }).getAttribute('href')).toBe('/app/hunt?query_draft=7');
  expect(screen.getByRole('link', { name: 'Open compared refined draft #8' }).getAttribute('href')).toBe('/app/hunt?query_draft=8');
  expect(screen.getByText(/since removed/)).toBeTruthy(); expect(screen.getByText(/before moved later/)).toBeTruthy();
});
it.each(['wrong_id', 'changed_fingerprint', 'malformed_queries'])('refuses an unmatched source without a guessed replacement: %s', async mode => {
  const { source } = show();
  if (mode === 'wrong_id') source.session_id = 99;
  if (mode === 'changed_fingerprint') source.fingerprint = 'c'.repeat(64);
  if (mode === 'malformed_queries') source.draft.queries = [];
  get.mockResolvedValueOnce({ data: source }); read(); await screen.findByRole('alert');
  expect(screen.queryByRole('article')).toBeNull(); expect(get).toHaveBeenCalledTimes(1); expect(post).not.toHaveBeenCalled();
});
it('keeps a missing or foreign source unavailable rather than reading history or another source', async () => {
  show(); get.mockRejectedValueOnce({ response: { status: 404 } }); read(); await screen.findByRole('alert');
  expect(get).toHaveBeenCalledExactlyOnceWith('/hunt/query-drafts/7'); expect(post).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Download loaded draft source comparison JSON' })).toBeNull();
});
it('does not read while disabled', () => { show(true); read(); expect(get).not.toHaveBeenCalled(); });
it('blocks duplicate requests and ignores a source that resolves after closing', async () => {
  let resolve!: (value: unknown) => void;
  get.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.get>);
  const { source } = show(); const button = screen.getByRole('button', { name: 'Compare with recorded source' });
  fireEvent.click(button); fireEvent.click(button); expect(get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close source comparison' }));
  resolve({ data: source }); await Promise.resolve();
  expect(screen.queryByRole('article')).toBeNull(); expect(screen.getByRole('button', { name: 'Compare with recorded source' })).toBeTruthy();
});
it('ignores a response after the comparison unmounts', async () => {
  let resolve!: (value: unknown) => void;
  get.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.get>);
  const view = show(); read(); view.unmount(); resolve({ data: view.source }); await Promise.resolve();
  expect(screen.queryByRole('article')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('clears an old pair while refreshing and never leaves it visible after source drift', async () => {
  const { source } = show(); get.mockResolvedValueOnce({ data: source }); read(); await screen.findByRole('article');
  let resolve!: (value: unknown) => void;
  get.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.get>);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh exact source comparison' }));
  expect(screen.queryByRole('article')).toBeNull(); resolve({ data: { ...source, fingerprint: 'c'.repeat(64) } });
  await screen.findByRole('alert'); expect(screen.queryByRole('article')).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
});
it('downloads both loaded drafts without another read or query', async () => {
  const save = vi.spyOn(evidence, 'saveHuntDownload').mockImplementation(() => {});
  const { source, refined } = show(); get.mockResolvedValueOnce({ data: source }); read(); await screen.findByRole('article');
  fireEvent.click(screen.getByRole('button', { name: 'Download loaded draft source comparison JSON' }));
  const value = JSON.parse(save.mock.calls[0][0]); expect(value.source).toEqual(source); expect(value.refined).toEqual(refined);
  expect(save.mock.calls[0][1]).toBe('hunt-draft-8-vs-source-7.json'); expect(value.query_results).toBeUndefined();
  expect(value.scope).toContain('Keep private'); expect(get).toHaveBeenCalledTimes(1); expect(post).not.toHaveBeenCalled();
});
it('reports a failed download while preserving the loaded comparison and not fetching again', async () => {
  vi.spyOn(evidence, 'saveHuntDownload').mockImplementation(() => { throw Error('download unavailable'); });
  const { source } = show(); get.mockResolvedValueOnce({ data: source }); read(); await screen.findByRole('article');
  fireEvent.click(screen.getByRole('button', { name: 'Download loaded draft source comparison JSON' })); await screen.findByRole('alert');
  expect(screen.getByRole('article')).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1);
});
it('rejects invalid child provenance before selecting any source to read', async () => {
  const { refined } = draftSourceFixture(); refined.draft.refinement!.source_session_id = refined.session_id;
  render(<HuntDraftSourceComparison refined={refined} />); read(); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
