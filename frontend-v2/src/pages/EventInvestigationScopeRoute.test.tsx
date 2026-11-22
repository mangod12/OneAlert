import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { EventSourceRoute } from './EventSourceRoute';
import { emptyEventScope, eventScopeFromParams, eventScopeLink, type EventInvestigationScope } from '../utils/eventInvestigationScope';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const scope: EventInvestigationScope = { ...emptyEventScope, source_id: '7', recorded_field: 'username', recorded_value: ' Actor_%+名 ', started_at: '2026-01-01T00:00:00.000001Z', ended_before: '2026-01-01T00:00:00.000002Z', severity: 'high', event_type: 'okta_system', source_type: 'okta_system', ip: '192.0.2.%', signature: 'recorded_%+名', sort: 'timestamp_asc' };
const nextScope = { ...emptyEventScope, recorded_field: 'hostname', recorded_value: 'next-host', ended_before: '2026-01-02T00:00:00.000Z', sort: 'severity_desc' };
const query = (value: unknown) => '?' + new URLSearchParams({ event_scope: JSON.stringify(value) });
const listCalls = () => get.mock.calls.filter(([url]) => url === '/events/');
const linkScope = () => eventScopeFromParams(new URL(screen.getByRole('link', { name: 'Open complete applied-scope event link' }).getAttribute('href')!, 'https://example.test').searchParams);
const expected = { page: 1, size: 50, source_id: '7', recorded_field: 'username', recorded_value: scope.recorded_value, started_at: scope.started_at, ended_before: scope.ended_before, severity: 'high', event_type: 'okta_system', source_type: 'okta_system', ip: scope.ip, signature: scope.signature, sort: 'timestamp_asc' };
beforeEach(() => {
  vi.resetAllMocks(); get.mockImplementation(async url => ({ data: url === '/events/' ? { events: [], total: 0 } : url === '/events/stats' ? { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } : url === '/events/types' ? { types: ['okta_system'] } : url === '/events/views/' ? [] : url === '/events/export' ? new Blob(['id\n']) : [] }));
  post.mockResolvedValue({ data: { id: 1, name: 'Applied scope', filters: {} } });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn().mockReturnValue('blob:synthetic'), revokeObjectURL: vi.fn() })); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(search = query(scope)) {
  function App() { const navigate = useNavigate(); return <><button onClick={() => navigate(eventScopeLink(nextScope).replace('/app', ''))}>Next complete scope</button><button onClick={() => navigate('/events?source_id=12')}>Legacy source</button><button onClick={() => navigate('/events?event_scope=bad')}>Invalid scope</button><EventSourceRoute /></>; }
  render(<MemoryRouter initialEntries={['/events' + search]}><App /></MemoryRouter>);
}
it.each(['?event_scope=', '?event_scope=bad', query({ ...scope, version: 2 }), query({ ...scope, page: 2 }), query({ ...scope, started_at: '2026-02-30T00:00:00Z' }), query({ ...scope, recorded_value: '' }), query({ ...scope, sort: 'unknown' }), query({ ...scope, source_id: '01' }), query(scope) + '&source_id=7', query(scope) + '&event_scope=bad', query({ source_id: '7' })])('fails closed before every read for malformed complete scope %s', search => {
  mount(search); expect(screen.getByRole('alert').textContent).toContain('not broadened'); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
});
it('uses every validated initial filter on its very first read, without a broad intermediate request', async () => {
  mount(); await waitFor(() => expect(listCalls()).toHaveLength(1)); expect(listCalls()[0][1]?.params).toEqual(expected);
  expect(linkScope()).toEqual(scope); expect((screen.getByLabelText('Exact recorded text') as HTMLInputElement).value).toBe(scope.recorded_value); expect((screen.getByLabelText('Search by signature') as HTMLInputElement).value).toBe(scope.signature);
  expect((screen.getByLabelText('Event start time UTC') as HTMLInputElement).value).toBe('2026-01-01T00:00'); expect(post).not.toHaveBeenCalled();
});
it('keeps unapplied time and exact-field drafts out of the link, saved view and CSV query', async () => {
  mount(); await waitFor(() => expect(listCalls()).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Exact recorded text'), { target: { value: 'PRIVATE_UNAPPLIED_ACTOR' } }); fireEvent.change(screen.getByLabelText('Event end time UTC'), { target: { value: '2026-02-01T00:00:00' } }); expect(listCalls()).toHaveLength(1); expect(linkScope()).toEqual(scope);
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' })); const { page: _page, size: _size, sort: _sort, ...filters } = expected; void _page; void _size; void _sort;
  await waitFor(() => expect(get).toHaveBeenCalledWith('/events/export', { params: filters, responseType: 'blob' }));
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' })); fireEvent.change(await screen.findByLabelText('Name for the saved view'), { target: { value: 'Applied scope' } }); fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/events/views/', { name: 'Applied scope', filters: { ...filters, source_id: 7, sort: expected.sort } })); expect(JSON.stringify(linkScope())).not.toContain('PRIVATE_UNAPPLIED');
});
it('remounts complete scopes and legacy scope links without retaining restrictions from the prior route', async () => {
  mount(); await waitFor(() => expect(listCalls()).toHaveLength(1)); fireEvent.click(screen.getByRole('button', { name: 'Next complete scope' }));
  await waitFor(() => expect(listCalls().at(-1)?.[1]?.params).toEqual({ page: 1, size: 50, recorded_field: 'hostname', recorded_value: 'next-host', ended_before: nextScope.ended_before, sort: 'severity_desc' })); expect(linkScope()).toEqual(nextScope);
  fireEvent.click(screen.getByRole('button', { name: 'Legacy source' })); await waitFor(() => expect(listCalls().at(-1)?.[1]?.params).toEqual({ page: 1, size: 50, source_id: '12', sort: 'timestamp_desc' })); expect(linkScope()).toEqual({ ...emptyEventScope, source_id: '12' });
});
it('does not show a late old-scope response after a same-route full scope change', async () => {
  let resolve!: (value: unknown) => void; const original = get.getMockImplementation()!; get.mockImplementation((url, ...args) => url === '/events/' && listCalls().length === 1 ? new Promise(done => { resolve = done; }) : original(url, ...args));
  mount(); await waitFor(() => expect(listCalls()).toHaveLength(1)); fireEvent.click(screen.getByRole('button', { name: 'Next complete scope' })); await waitFor(() => expect(listCalls()).toHaveLength(2));
  await act(async () => resolve({ data: { events: [{ id: 99, signature: 'PRIVATE_OLD_SCOPE_ROW' }], total: 1 } })); expect(document.body.textContent).not.toContain('PRIVATE_OLD_SCOPE_ROW'); expect(linkScope()).toEqual(nextScope);
});
it('keeps unavailable sensor and event types visible rather than displaying All while retaining a hidden filter', async () => {
  mount(query({ ...scope, source_type: 'unlisted_sensor', event_type: 'unlisted_event' }));
  await screen.findByRole('option', { name: 'unlisted_sensor (not listed by current sources)' });
  expect((screen.getByLabelText('Filter by sensor type') as HTMLSelectElement).value).toBe('unlisted_sensor');
  expect((screen.getByLabelText('Filter by event type') as HTMLSelectElement).value).toBe('unlisted_event');
  expect(screen.getByRole('option', { name: 'unlisted_event (not listed by current records)' })).toBeTruthy();
  expect(linkScope()).toEqual({ ...scope, source_type: 'unlisted_sensor', event_type: 'unlisted_event' });
});

it('switches to an invalid scope without substituting an all-events read', async () => {
  mount(); await waitFor(() => expect(listCalls()).toHaveLength(1)); const before = get.mock.calls.length; fireEvent.click(screen.getByRole('button', { name: 'Invalid scope' })); expect(screen.getByRole('alert').textContent).toContain('not broadened'); expect(get).toHaveBeenCalledTimes(before); expect(screen.queryByRole('link', { name: 'Open complete applied-scope event link' })).toBeNull();
});
