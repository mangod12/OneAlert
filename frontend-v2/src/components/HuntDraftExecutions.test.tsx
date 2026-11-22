import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import * as evidence from '../utils/huntEvidence';
import { draftExecutionPageFixture } from '../utils/huntDraftExecutions.fixture';
import { HuntDraftExecutions } from './HuntDraftExecutions';
import { HuntQueryDraftWorkflow } from './HuntQueryDraftWorkflow';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const show = (disabled = false) => { const fixture = draftExecutionPageFixture(); return { ...fixture, ...render(<HuntDraftExecutions source={fixture.source} disabled={disabled} />) }; };
const read = () => fireEvent.click(screen.getByRole('button', { name: 'Read saved execution receipts' }));
beforeEach(() => vi.clearAllMocks()); afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('reads only the exact source/fingerprint metadata on demand and shows original selection without claiming full execution verification', async () => {
  const { source, page } = show(); expect(get).not.toHaveBeenCalled(); get.mockResolvedValueOnce({ data: page }); read();
  await screen.findByRole('heading', { name: 'Saved record #100' }); expect(get).toHaveBeenCalledExactlyOnceWith('/hunt/query-drafts/7/executions', { params: { fingerprint: source.fingerprint, offset: 0, limit: 10 } }); expect(post).not.toHaveBeenCalled();
  expect(screen.getAllByText(/Supported selection receipt: original draft queries 1/).length).toBeGreaterThan(0); expect(screen.getByText(/Unsupported selection receipt/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Inspect exact saved record #100' }).getAttribute('href')).toBe('/app/hunt?session=100'); expect(screen.getAllByRole('link', { name: 'Inspect recorded hunt run #91' })[0].getAttribute('href')).toBe('/app/audit-log?run=91');
});
it('requests bounded next and previous pages without preserving rows from an earlier page', async () => {
  const { page } = show(); get.mockResolvedValueOnce({ data: page }); read(); await screen.findByRole('heading', { name: 'Saved record #100' });
  get.mockResolvedValueOnce({ data: draftExecutionPageFixture(10).page }); fireEvent.click(screen.getByRole('button', { name: 'Next receipt page' })); await screen.findByRole('heading', { name: 'Saved record #90' }); expect(screen.queryByRole('heading', { name: 'Saved record #100' })).toBeNull();
  expect(get.mock.calls[1][1]).toMatchObject({ params: { offset: 10 } });
  get.mockResolvedValueOnce({ data: page }); fireEvent.click(screen.getByRole('button', { name: 'Previous receipt page' })); await screen.findByRole('heading', { name: 'Saved record #100' }); expect(get.mock.calls[2][1]).toMatchObject({ params: { offset: 0 } });
});
it('exports only the loaded page without reading another page or executing anything', async () => {
  const save = vi.spyOn(evidence, 'saveHuntDownload').mockImplementation(() => {}), { page } = show(); get.mockResolvedValueOnce({ data: page }); read(); await screen.findByRole('heading', { name: 'Saved record #100' });
  fireEvent.click(screen.getByRole('button', { name: 'Download loaded receipt page JSON' })); const value = JSON.parse(save.mock.calls[0][0]); expect(value.executions).toHaveLength(10); expect(value.offset).toBe(0); expect(get).toHaveBeenCalledTimes(1); expect(post).not.toHaveBeenCalled();
});
it.each(['changed', 'wrong_page', 'malformed', 'missing'])('clears stale receipts and does not try a fallback after %s', async mode => {
  const { page } = show(); get.mockResolvedValueOnce({ data: page }); read(); await screen.findByRole('heading', { name: 'Saved record #100' });
  if (mode === 'changed') get.mockRejectedValueOnce({ response: { status: 409 } });
  else if (mode === 'missing') get.mockRejectedValueOnce({ response: { status: 404 } });
  else get.mockResolvedValueOnce({ data: mode === 'wrong_page' ? { ...page, offset: 10 } : {} });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved execution receipts' })); await screen.findByRole('alert'); expect(screen.queryByRole('article')).toBeNull(); expect(get).toHaveBeenCalledTimes(2); expect(post).not.toHaveBeenCalled(); expect(screen.getByRole('link', { name: 'Reopen exact source draft #7' }).getAttribute('href')).toBe('/app/hunt?query_draft=7');
});
it('keeps an empty page distinct from proof that no database execution happened', async () => {
  show(); get.mockResolvedValueOnce({ data: draftExecutionPageFixture(0, 0).page }); read(); await screen.findByText(/No matching saved receipt records on this page/); expect(screen.getByText(/Missing receipts or an empty page do not prove/)).toBeTruthy();
});
it('blocks duplicate reads and ignores late responses after close or unmount', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = show(); read(); fireEvent.click(screen.getByRole('button', { name: 'Refresh saved execution receipts' })); expect(get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close execution receipts' })); await act(async () => finish({ data: view.page })); expect(screen.queryByRole('article')).toBeNull();
  get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); read(); view.unmount(); await act(async () => finish({ data: view.page })); expect(screen.queryByRole('article')).toBeNull();
});
it('does not read while conflicting work disables the component', () => { show(true); read(); expect(get).not.toHaveBeenCalled(); });
it('keeps loaded rows after a failed download without issuing another read', async () => {
  vi.spyOn(evidence, 'saveHuntDownload').mockImplementation(() => { throw Error('Blocked'); }); const { page } = show(); get.mockResolvedValueOnce({ data: page }); read(); await screen.findByRole('heading', { name: 'Saved record #100' }); fireEvent.click(screen.getByRole('button', { name: 'Download loaded receipt page JSON' })); await screen.findByRole('alert'); expect(screen.getByRole('heading', { name: 'Saved record #100' })).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1);
});
it('remains available for receipt inspection after an uncertain execution while execution retry stays blocked', async () => {
  const { source, page } = draftExecutionPageFixture(); post.mockResolvedValueOnce({ data: { success: true, data: source } });
  render(<HuntQueryDraftWorkflow hypothesis={source.hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onExecuted={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' })); fireEvent.click(await screen.findByRole('checkbox', { name: 'Select original draft query 1' }));
  post.mockRejectedValueOnce(Error('Unknown execution outcome')); fireEvent.click(screen.getByRole('button', { name: 'Run 1 selected saved query' })); await screen.findByText(/Execution may already have run/);
  get.mockResolvedValueOnce({ data: page }); read(); await screen.findByRole('heading', { name: 'Saved record #100' });
  expect(post).toHaveBeenCalledTimes(2); expect((screen.getByRole('button', { name: 'Run 0 selected saved queries' }) as HTMLButtonElement).disabled).toBe(true);
});
