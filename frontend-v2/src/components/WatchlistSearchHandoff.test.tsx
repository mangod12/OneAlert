import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { WatchlistExplorer } from './WatchlistExplorer';
import { Watchlist } from '../pages/Watchlist';
vi.mock('./SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get), writeText = vi.fn();
const defaults = { query: '', kind: 'all', severity: 'all', scope: 'all', sort: 'severity' };
function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate('?explore=1&query=new&kind=case')}>Open different search link</button>; }
const mount = (query: string, full = false) => render(<MemoryRouter initialEntries={[`/watchlist?${query}`]}>{full ? <Watchlist /> : <WatchlistExplorer />}<Navigation /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); writeText.mockResolvedValue(undefined); get.mockImplementation(async (url, config) => ({ data: url === '/cases/watched-record-explorer' ? { data: [], total: 0, ...(config?.params as object), date_basis: '2026-11-21' } : url === '/alerts/' ? { alerts: [], total: 0 } : { cases: [], total: 0 } })); });
afterEach(cleanup);
it('restores all applied fields at page one and opens the full explorer from the watchlist route', async () => {
  mount('explore=1&query=gateway&kind=alert&severity=high&scope=overdue&sort=due', true);
  await screen.findByText(/0 followed records match/);
  expect(get).toHaveBeenCalledWith('/cases/watched-record-explorer', { params: { page: 1, size: 25, query: 'gateway', kind: 'alert', severity: 'high', scope: 'overdue', sort: 'due' } });
  expect((screen.getByLabelText('Search all watched records') as HTMLInputElement).value).toBe('gateway');
  fireEvent.click(screen.getByRole('button', { name: 'Back to loaded watchlist review' })); await screen.findByRole('button', { name: 'Search entire watchlist' }); expect(screen.queryByLabelText('Search all watched records')).toBeNull();
});
it.each(['explore=0', 'explore=1&explore=1', 'kind=alert&kind=case', 'severity=high&severity=low', 'query=a&query=b', 'scope=overdue&scope=done', 'sort=name&sort=due', 'kind=private', 'severity=urgent', 'scope=closed', 'sort=random', `query=${'x'.repeat(201)}`])('rejects malformed or ambiguous handoff without a broad explorer query: %s', async query => {
  mount(query); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Copy applied watchlist search link' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear full watchlist filters' })); await screen.findByText(/0 followed records match/); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/watched-record-explorer', { params: { ...defaults, page: 1, size: 25 } });
});
it('copies applied keywords and filters, excluding drafts, pagination, unrelated URL data and results', async () => {
  mount('explore=1&query=gateway&kind=case&scope=active&sort=due&private=omit#private'); await screen.findByText(/0 followed records match/);
  fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'unsubmitted draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Copy applied watchlist search link' })); await screen.findByText(/Applied watchlist search link copied/);
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/watchlist?explore=1&query=gateway&kind=case&scope=active&sort=due`);
  expect(screen.getByText(/Each viewer sees only their own current followed records/)).toBeTruthy(); expect(get).toHaveBeenCalledOnce();
});
it('encodes literal punctuation and Unicode keywords without changing their meaning', async () => {
  const query = 'gateway + π & 100%_'; mount(new URLSearchParams({ explore: '1', query }).toString()); await screen.findByText(/0 followed records match/);
  fireEvent.click(screen.getByRole('button', { name: 'Copy applied watchlist search link' })); await screen.findByText(/Applied watchlist search link copied/);
  expect(new URL(writeText.mock.calls[0][0]).searchParams.get('query')).toBe(query);
});
it('replaces same-page URL scope and ignores an old response after navigation', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); mount('explore=1&query=old');
  fireEvent.click(screen.getByRole('button', { name: 'Open different search link' })); await screen.findByText(/0 followed records match/);
  expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { ...defaults, query: 'new', kind: 'case', page: 1, size: 25 } });
  await act(async () => finish({ data: { data: [{ id: 99, kind: 'alert', title: 'Old result' }], total: 1 } })); expect(screen.queryByText('Old result')).toBeNull();
});
it('reports clipboard failure without changing the watch search or claiming URL synchronization', async () => {
  writeText.mockRejectedValueOnce(new Error('denied')); mount('query=gateway'); await screen.findByText(/0 followed records match/); fireEvent.click(screen.getByRole('button', { name: 'Copy applied watchlist search link' }));
  await screen.findByText('Copy unavailable. Your applied watchlist search is unchanged.'); expect(screen.queryByRole('alert')).toBeNull(); expect(get).toHaveBeenCalledOnce();
});
it('does not confirm a copied older scope after the filter changes', async () => {
  let finish!: () => void; writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })); mount('query=gateway'); await screen.findByText(/0 followed records match/);
  fireEvent.click(screen.getByRole('button', { name: 'Copy applied watchlist search link' })); fireEvent.change(screen.getByLabelText('Full watchlist type'), { target: { value: 'case' } }); await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await act(async () => finish()); expect(screen.queryByText(/Applied watchlist search link copied/)).toBeNull();
});
