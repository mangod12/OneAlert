import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { EventSourceRoute } from './EventSourceRoute';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup(query: string) {
  get.mockImplementation(async url => ({ data: url === '/events/' ? { events: [], total: 0 } : url === '/events/stats' ? { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } : url === '/events/types' ? { types: [] } : [] }));
  function Navigation() { const navigate = useNavigate(); return <><button onClick={() => navigate('/events?recorded_field=hostname&recorded_value=next-host')}>Next label</button><EventSourceRoute /></>; }
  render(<MemoryRouter initialEntries={[`/events${query}`]}><Navigation /></MemoryRouter>);
}
it.each(['?recorded_field=username', '?recorded_value=actor', '?recorded_field=raw_data&recorded_value=actor', '?recorded_field=username&recorded_value=', '?recorded_field=username&recorded_value=%20', '?recorded_field=username&recorded_field=hostname&recorded_value=actor', '?recorded_field=username&recorded_value=one&recorded_value=two', '?recorded_field=username&recorded_value=%00', '?recorded_field=username&recorded_value=' + 'x'.repeat(1025)])('fails closed before reads for malformed exact links %s', query => {
  setup(query); expect(screen.getByRole('alert').textContent).toContain('not broadened'); expect(get).not.toHaveBeenCalled();
});
it('preserves source plus exact Unicode text and remounts a same-route field change without stale filters', async () => {
  setup('?' + new URLSearchParams({ source_id: '7', recorded_field: 'username', recorded_value: ' Actor_%+名 ' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc', source_id: '7', recorded_field: 'username', recorded_value: ' Actor_%+名 ' } }));
  expect((screen.getByLabelText('Exact recorded text') as HTMLInputElement).value).toBe(' Actor_%+名 ');
  fireEvent.click(screen.getByRole('button', { name: 'Next label' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc', recorded_field: 'hostname', recorded_value: 'next-host' } }));
});
