import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { WatchlistExplorer } from './WatchlistExplorer';
vi.mock('./SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const result = { data: [], page: 1, size: 25, total: 0, date_basis: '2026-11-24', summary: { alerts: 0, cases: 0, active: 0, done: 0, overdue: 0, active_without_due_date: 0 } };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: result }); });
afterEach(cleanup);
it.each(['today', 'future', 'undated'])('restores %s due triage from a search handoff and keeps unapplied drafts private', async scope => {
  const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<MemoryRouter initialEntries={['/app/watchlist?explore=1&scope=' + scope]}><WatchlistExplorer /></MemoryRouter>);
  await screen.findByText(/0 followed records match/);
  expect(get).toHaveBeenCalledExactlyOnceWith('/cases/watched-record-explorer', { params: { query: '', kind: 'all', severity: 'all', scope, sort: 'severity', page: 1, size: 25 } });
  expect(screen.getByLabelText('Full watchlist scope')).toHaveProperty('value', scope);
  fireEvent.change(screen.getByLabelText('Search all watched records'), { target: { value: 'unapplied draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Copy applied watchlist search link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).toContain('scope=' + scope); expect(writeText.mock.calls[0][0]).not.toContain('draft');
  expect(get).toHaveBeenCalledOnce();
});
it.each(['today', 'future', 'undated'])('changes %s criteria at the server, not a loaded-page filter', async scope => {
  render(<MemoryRouter><WatchlistExplorer /></MemoryRouter>); await screen.findByText(/0 followed records match/);
  fireEvent.change(screen.getByLabelText('Full watchlist scope'), { target: { value: scope } });
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/watched-record-explorer', { params: { query: '', kind: 'all', severity: 'all', scope, sort: 'severity', page: 1, size: 25 } }));
});
