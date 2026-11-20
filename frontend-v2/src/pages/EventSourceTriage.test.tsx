import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Events } from './Events';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import apiClient from '../api/client';
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const source = { id: 7, name: 'Plant A gateway', source_type: 'suricata', status: 'active', event_count: 42, last_event_at: null };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(unavailable = false) {
  get.mockImplementation(async (url: string) => {
    if (url === '/events/') return { data: { events: [], total: 0 } };
    if (url === '/events/stats') return { data: { data: { total_events: 42, by_severity: {}, by_type: {}, source_count: 1 } } };
    if (url === '/events/sources') { if (unavailable) throw new Error('unavailable'); return { data: [source] }; }
    if (url === '/events/views/') return { data: [{ id: 1, name: 'Saved plant', filters: { source_id: 7 }, created_at: '' }] };
    if (url === '/events/export') return { data: new Blob(['id\n1']) };
    return { data: { types: [] } };
  });
  render(<Events />);
}
describe('Recorded event source triage', () => {
  it('filters list and export by source ID and clears without losing parser filters', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'View events from Plant A gateway' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc', source_id: '7' } }));
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.change(screen.getByLabelText('Filter by sensor type'), { target: { value: 'suricata' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/events/export', { params: { source_id: '7', source_type: 'suricata' }, responseType: 'blob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear recorded source' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, sort: 'timestamp_desc', source_type: 'suricata' } }));
  });
  it('saves and restores the recorded ID without inventing missing source details', async () => {
    setup(true); await screen.findByText('Recorded source details are unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Saved plant', exact: true }));
    expect((screen.getByLabelText('Recorded source') as HTMLSelectElement).value).toBe('7');
    expect(screen.getByRole('option', { name: 'Source #7 (details unavailable)' })).toBeTruthy();
    post.mockResolvedValue({ data: { id: 2, name: 'Copied plant', filters: { source_id: 7 }, created_at: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
    fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'Copied plant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current view' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/events/views/', { name: 'Copied plant', filters: { source_id: 7, sort: 'timestamp_desc' } }));
  });
});
