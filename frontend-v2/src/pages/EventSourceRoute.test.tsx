import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { EventSourceRoute } from './EventSourceRoute';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
import apiClient from '../api/client';
const get = vi.mocked(apiClient.get);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup(query: string) {
  get.mockImplementation(async (url: string) => {
    if (url === '/events/') return { data: { events: [], total: 0 } };
    if (url === '/events/stats') return { data: { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } };
    if (url === '/events/sources') return { data: [] };
    if (url === '/events/views/') return { data: [] };
    return { data: { types: [] } };
  });
  function Navigation() { const navigate = useNavigate(); return <><button onClick={() => navigate('/events?source_id=12')}>Next source</button><EventSourceRoute /></>; }
  render(<MemoryRouter initialEntries={[`/events${query}`]}><Navigation /></MemoryRouter>);
}
it.each(['?source_id=', '?source_id=0', '?source_id=-1', '?source_id=7&source_id=8', '?source_id=01', '?source_id=7.0', '?source_id=2147483648', '?source_id=%20'])('never broadens malformed source link %s', query => {
  setup(query); expect(screen.getByRole('alert').textContent).toContain('not broadened'); expect(get).not.toHaveBeenCalled();
});
it('initially scopes only by exact ID, keeps absent source names honest and navigates same-route changes', async () => {
  setup('?source_id=7'); await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc', source_id: '7' } }));
  expect(screen.getByRole('option', { name: 'Source #7 (details unavailable)' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open source-only event link' }).getAttribute('href')).toBe('/app/events?source_id=7');
  fireEvent.click(screen.getByRole('button', { name: 'Next source' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc', source_id: '12' } }));
  expect((screen.getByLabelText('Recorded source') as HTMLSelectElement).value).toBe('12');
});
it('leaves ordinary all-source entry available when source_id is absent', async () => {
  setup(''); await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc' } }));
});
