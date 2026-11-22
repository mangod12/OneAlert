import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Events } from './Events';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const exact = { recorded_field: 'username', recorded_value: ' Actor_%+名 ' };
const views = [{ id: 1, name: 'Saved exact actor', filters: { ...exact, source_id: 7, sort: 'timestamp_asc' } }, { id: 2, name: 'All events', filters: {} }, { id: 3, name: 'Invalid partial scope', filters: { recorded_field: 'username', severity: 'critical' } }];
const listCalls = () => get.mock.calls.filter(([url]) => url === '/events/');
beforeEach(() => {
  vi.resetAllMocks(); get.mockImplementation(async url => ({ data: url === '/events/' ? { events: [], total: 0 } : url === '/events/stats' ? { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } : url === '/events/types' ? { types: [] } : url === '/events/views/' ? views : url === '/events/export' ? new Blob(['id,username\n1,actor\n']) : [] }));
  post.mockResolvedValue({ data: { id: 4, name: 'Applied actor', filters: exact } });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn().mockReturnValue('blob:synthetic'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { render(<Events />); await waitFor(() => expect(listCalls()).toHaveLength(1)); }
async function apply(value = exact.recorded_value, field = 'username') {
  fireEvent.change(screen.getByLabelText('Exact recorded field'), { target: { value: field } }); fireEvent.change(screen.getByLabelText('Exact recorded text'), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: 'Apply exact recorded field' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc', recorded_field: field, recorded_value: value } }));
}
it('drafts locally, applies exact text without trim or wildcard conversion, and clears explicitly', async () => {
  await mount(); fireEvent.change(screen.getByLabelText('Exact recorded text'), { target: { value: exact.recorded_value } }); expect(listCalls()).toHaveLength(1); expect(screen.getByText(/Exact-field draft not applied/)).toBeTruthy();
  await apply(); expect(screen.getByLabelText('Applied exact recorded scope').textContent).toBe('Applied exact username = ' + exact.recorded_value);
  expect(screen.getByRole('link', { name: 'Open exact-field-only event link' }).getAttribute('href')).toContain('recorded_value=');
  fireEvent.click(screen.getByRole('button', { name: 'Clear exact recorded field' })); await waitFor(() => expect(listCalls().at(-1)?.[1]?.params).toEqual({ page: 1, size: 50, sort: 'timestamp_desc' }));
});
it('exports and saves applied scope, never unsent draft text or pagination', async () => {
  await mount(); await apply(); fireEvent.change(screen.getByLabelText('Exact recorded text'), { target: { value: 'UNAPPLIED_PRIVATE_DRAFT' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' })); await waitFor(() => expect(get).toHaveBeenCalledWith('/events/export', { params: exact, responseType: 'blob' }));
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); await screen.findByRole('button', { name: 'Saved exact actor' }); fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'Applied actor' } }); fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/events/views/', { name: 'Applied actor', filters: { ...exact, sort: 'timestamp_desc' } }));
});
it('restores a complete saved exact scope and resets it with an empty saved view', async () => {
  await mount(); fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Saved exact actor' }));
  await waitFor(() => expect(listCalls().at(-1)?.[1]?.params).toEqual({ page: 1, size: 50, sort: 'timestamp_asc', source_id: '7', ...exact })); expect((screen.getByLabelText('Exact recorded text') as HTMLInputElement).value).toBe(exact.recorded_value);
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(screen.getByRole('button', { name: 'All events' })); await waitFor(() => expect(listCalls().at(-1)?.[1]?.params).toEqual({ page: 1, size: 50, sort: 'timestamp_desc' })); expect((screen.getByLabelText('Exact recorded text') as HTMLInputElement).value).toBe('');
});
it('refuses a malformed saved scope without changing other filters or broadening the current query', async () => {
  await mount(); await apply(); const before = listCalls().length;
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.click(await screen.findByRole('button', { name: 'Invalid partial scope' })); expect(await screen.findByText(/No filters changed/)).toBeTruthy(); expect(listCalls()).toHaveLength(before); expect(screen.getByLabelText('Applied exact recorded scope').textContent).toContain(exact.recorded_value);
});
it('refuses blank drafts while preserving applied scope and never guesses a wildcard search', async () => {
  await mount(); await apply(); const before = listCalls().length;
  fireEvent.change(screen.getByLabelText('Exact recorded text'), { target: { value: '  ' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply exact recorded field' })); expect(screen.getByRole('alert').textContent).toContain('Applied scope was not changed'); expect(listCalls()).toHaveLength(before);
});
it('discards a late prior-scope response after an explicit new exact field read', async () => {
  await mount(); let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(done => { resolve = done; })); await apply('old-actor'); await apply('new-host', 'hostname');
  await act(async () => resolve({ data: { events: [{ id: 99, signature: 'STALE_PRIVATE_EVENT' }], total: 1 } })); expect(document.body.textContent).not.toContain('STALE_PRIVATE_EVENT'); expect(screen.getByLabelText('Applied exact recorded scope').textContent).toContain('new-host');
});
