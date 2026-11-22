import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Events } from './Events';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import apiClient from '../api/client';
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
afterEach(() => { cleanup(); vi.resetAllMocks(); });
async function upload() {
  fireEvent.click(screen.getByRole('button', { name: 'Upload events' }));
  const file = new File(['{"timestamp":"2026-01-01T00:00:00Z","event_type":"alert"}'], 'receipt.json', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Log file'), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Upload 1 record' }));
}
function setup() {
  get.mockImplementation(async (url: string) => {
    if (url === '/events/') return { data: { events: [], total: 0 } };
    if (url === '/events/stats') return { data: { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } };
    if (url === '/events/sources') return { data: [] };
    return { data: { types: [] } };
  });
  render(<Events />);
}
describe('Event import response integration', () => {
  it('shows zero accepted rows, does not fabricate success and dismisses without another request', async () => {
    post.mockResolvedValue({ data: { data: { received: 1, ingested: 0, skipped: 1, redacted: 0, source_id: 9, skip_reasons: { invalid_timestamp: 1 } } } });
    setup(); await screen.findByText('No events ingested yet'); await upload();
    expect(await screen.findByText('No events were imported.')).toBeTruthy();
    expect(screen.getByText('Missing, invalid or ambiguous recorded timestamp: 1')).toBeTruthy();
    expect(screen.getByText(/Source ID: 9/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss import response' }));
    expect(screen.queryByRole('region', { name: 'Last event import response' })).toBeNull();
    expect(post).toHaveBeenCalledOnce();
  });
  it('does not replace a completed receipt with a false one after a later failed upload', async () => {
    post.mockResolvedValueOnce({ data: { data: { received: 1, ingested: 1, skipped: 0, source_id: 5 } } }).mockRejectedValueOnce(new Error('write failed'));
    setup(); await screen.findByText('No events ingested yet'); await upload();
    await screen.findByRole('region', { name: 'Last event import response' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await upload(); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Source ID: 5/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

it('does not turn an omitted imported counter into a recorded zero', async () => {
  post.mockResolvedValue({ data: { data: { received: 1, skipped: 0 } } }); setup(); await screen.findByText('No events ingested yet'); await upload();
  expect(await screen.findByText('Imported count was not recorded in this response.')).toBeTruthy(); expect(screen.queryByText('No events were imported.')).toBeNull(); expect(post).toHaveBeenCalledOnce();
});
it('does not accept an explicitly non-success upload envelope as a completed import', async () => {
  post.mockResolvedValue({ data: { success: false, data: { received: 1, ingested: 1, skipped: 0 } } }); setup(); await screen.findByText('No events ingested yet'); await upload();
  await screen.findByText(/Import was not confirmed/); expect(screen.queryByRole('region', { name: 'Last event import response' })).toBeNull(); expect(screen.getByRole('dialog')).toBeTruthy(); expect(post).toHaveBeenCalledOnce();
});
