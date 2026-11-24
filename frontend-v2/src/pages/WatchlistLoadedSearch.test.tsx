import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Watchlist } from './Watchlist';
vi.mock('../components/SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
vi.mock('../api/client', () => ({ default: { get: vi.fn(), delete: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const alert = { id: 4, title: 'Gateway alert', cve_id: null, asset_name: 'Gateway', severity: 'high', status: 'pending', created_at: '2026-11-01T00:00:00Z' };
const investigation = { id: 9, title: 'Gateway investigation', severity: 'high', status: 'open', due_date: '2020-01-01', created_at: '2026-11-01T00:00:00Z' };
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (url, config) => ({ data: url === '/alerts/' ? { alerts: [alert], total: 1 } : url === '/cases/' ? { cases: [investigation], total: 1 } : { data: [], total: 0, page: 1, size: 25, date_basis: '2026-11-24', ...(config?.params as object) } })); });
afterEach(cleanup);
async function show() { render(<MemoryRouter><Watchlist /></MemoryRouter>); await screen.findByText('Gateway investigation'); }
it('opens current full search with exact loaded filters without carrying selection or executing unwatch, then returns to kept selection', async () => {
 await show(); fireEvent.click(screen.getByLabelText('Select case #9: Gateway investigation'));fireEvent.change(screen.getByLabelText('Find watched items'), { target: { value: '  Gateway  ' } }); fireEvent.change(screen.getByLabelText('Watched severity'), { target: { value: 'high' } });fireEvent.change(screen.getByLabelText('Watched work scope'), { target: { value: 'open' } });fireEvent.change(screen.getByLabelText('Watched item order'), { target: { value: 'name' } });fireEvent.click(screen.getByRole('button', { name: 'Search entire watchlist with these filters' }));
 await waitFor(() => expect(get).toHaveBeenCalledWith('/cases/watched-record-explorer', { params: { query: 'Gateway', kind: 'all', severity: 'high', scope: 'active', sort: 'name', page: 1, size: 25 } }));expect(apiClient.delete).not.toHaveBeenCalled();expect(apiClient.post).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button', { name: 'Back to loaded watchlist review' }));expect(screen.getByLabelText('Select case #9: Gateway investigation')).toHaveProperty('checked', true);expect(screen.getByLabelText('Find watched items')).toHaveProperty('value', '  Gateway  ');
});
it('preserves investigation-only loaded overdue instead of widening to alert due dates', async () => {
 await show();fireEvent.change(screen.getByLabelText('Watched work scope'), { target: { value: 'overdue' } });fireEvent.click(screen.getByRole('button', { name: 'Search entire watchlist with these filters' }));await waitFor(() => expect(get).toHaveBeenCalledWith('/cases/watched-record-explorer', { params: { query: '', kind: 'case', severity: 'all', scope: 'overdue', sort: 'severity', page: 1, size: 25 } }));
});
it('refuses an incompatible alert/investigation-only overdue intersection without running a wider query', async () => {
 await show();fireEvent.change(screen.getByLabelText('Watched item type'), { target: { value: 'alert' } });fireEvent.change(screen.getByLabelText('Watched work scope'), { target: { value: 'overdue' } });expect(screen.getByRole('button', { name: 'Search entire watchlist with these filters' })).toHaveProperty('disabled', true);expect(screen.getByText(/Alerts with investigation-only overdue is incompatible/)).toBeTruthy();expect(get).toHaveBeenCalledTimes(2);
});
it('does not silently truncate longer loaded search input', async () => {
 await show();fireEvent.change(screen.getByLabelText('Find watched items'), { target: { value: 'x'.repeat(201) } });expect(screen.getByRole('button', { name: 'Search entire watchlist with these filters' })).toHaveProperty('disabled', true);expect(screen.getByText(/No keywords were truncated/)).toBeTruthy();expect(get).toHaveBeenCalledTimes(2);
});
