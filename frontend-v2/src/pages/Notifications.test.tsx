import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notifications } from './Notifications';

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockDelete = vi.mocked(apiClient.delete);

function listResponse(items: unknown[], total: number, unread: number, page = 1) {
  return { data: { success: true, data: items, total, unread_count: unread, page, size: 20 } };
}

const mk = (id: number, kind: string, title: string, read: boolean) => ({
  id, kind, title, body: `body ${id}`, link: '/app/alerts', read_at: read ? '2026-11-18T00:00:00Z' : null,
  created_at: new Date().toISOString(),
});

function renderPage() {
  return render(<MemoryRouter><Notifications /></MemoryRouter>);
}

describe('Notifications page', () => {
  beforeEach(() => { vi.clearAllMocks(); mockPost.mockResolvedValue({} as never); });
  afterEach(() => { cleanup(); });

  it('lists notifications with kind labels and grouping', async () => {
    mockGet.mockResolvedValue(listResponse([
      mk(3, 'alert_updated', 'Alert #7 was resolved', false),
      mk(2, 'alert_updated', 'Alert #7 was resolved', false),
      mk(1, 'case_assigned', 'Case #4 assigned to you', true),
    ], 3, 2) as never);
    renderPage();
    expect(await screen.findByText('×2')).toBeTruthy();
    expect(screen.getByText('Case #4 assigned to you')).toBeTruthy();
    expect(screen.getAllByText(/Alert updates/).length).toBeGreaterThan(0);
    expect(screen.getByText('2 unread')).toBeTruthy();
  });

  it('labels task due reminders', async () => {
    mockGet.mockResolvedValue(listResponse([
      mk(5, 'case_task_overdue', 'Task overdue: Eradicate persistence', false),
      mk(4, 'case_task_due_soon', 'Task due tomorrow: Collect triage image', false),
    ], 2, 2) as never);
    renderPage();
    expect(await screen.findByText('Task overdue: Eradicate persistence')).toBeTruthy();
    expect(screen.getByText('Task overdue')).toBeTruthy();
    expect(screen.getByText('Task due soon')).toBeTruthy();
  });

  it('passes the kind and unread filters to the API', async () => {
    mockGet.mockResolvedValue(listResponse([], 0, 0) as never);
    renderPage();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { page: 1, size: 20, unread_only: false } }));
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'case_mention' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { page: 1, size: 20, unread_only: false, kind: 'case_mention' } }));
    fireEvent.click(screen.getByLabelText('Unread only'));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { page: 1, size: 20, unread_only: true, kind: 'case_mention' } }));
  });

  it('marks every unread item in a group read when opened', async () => {
    mockGet.mockResolvedValue(listResponse([mk(2, 'alert_updated', 'Alert #7 updated', false), mk(1, 'alert_updated', 'Alert #7 updated', false)], 2, 2) as never);
    renderPage();
    fireEvent.click(await screen.findByText('Alert #7 updated'));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/notifications/2/read');
      expect(mockPost).toHaveBeenCalledWith('/notifications/1/read');
    });
  });

  it('paginates through the feed', async () => {
    mockGet.mockResolvedValue(listResponse([mk(9, 'alert_created', 'New alert', false)], 45, 1) as never);
    renderPage();
    expect(await screen.findByText('Page 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { page: 2, size: 20, unread_only: false } }));
  });


  it('routes cleanup through an explicit exact-ID review instead of global actions', async () => {
    const item = mk(1, 'alert_created', 'Reviewed alert', false);
    mockGet.mockImplementation(async (url) => url === '/notifications/review-batch'
      ? { data: { operation: 'mark_read', kind: null, total: 1, records: [item], fingerprint: 'a'.repeat(64) } }
      : listResponse([item], 1, 1));
    mockPost.mockResolvedValue({ data: { success: true, operation: 'mark_read', affected: 1, ids: [1] } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Review matching unread notifications' }));
    await screen.findByRole('list', { name: 'Exact notification cleanup review' });
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 notifications' }));
    await screen.findByText(/1 reviewed notifications marked read/);
    expect(mockPost).toHaveBeenCalledWith('/notifications/review-batch', { operation: 'mark_read', kind: null, ids: [1], fingerprint: 'a'.repeat(64) });
    expect(mockPost).not.toHaveBeenCalledWith('/notifications/read-all');
  });

  it('deletes a group', async () => {
    mockDelete.mockResolvedValue({} as never);
    mockGet.mockResolvedValue(listResponse([mk(2, 'alert_updated', 'Alert #7 updated', true), mk(1, 'alert_updated', 'Alert #7 updated', true)], 2, 0) as never);
    renderPage();
    fireEvent.click(await screen.findByLabelText('Delete 2 notifications: Alert #7 updated'));
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/notifications/2');
      expect(mockDelete).toHaveBeenCalledWith('/notifications/1');
    });
  });


  it('removes only confirmed deletions from a partially failed group', async () => {
    mockGet.mockResolvedValue(listResponse([mk(2, 'alert_updated', 'Same alert', false), mk(1, 'alert_updated', 'Same alert', false)], 2, 2) as never);
    mockDelete.mockImplementation(async url => {
      if (url === '/notifications/2') return {} as never;
      throw new Error('Offline');
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 2 notifications: Same alert' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('1 unread')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete notification Same alert' })).toBeTruthy();
  });


  it('keeps load errors distinct from no results or all caught up and retries', async () => {
    mockGet.mockRejectedValueOnce(new Error('Offline'));
    renderPage();
    await screen.findByRole('button', { name: 'Retry notifications' });
    expect(screen.queryByText('No notifications match these filters')).toBeNull();
    expect(screen.queryByText('All caught up')).toBeNull();
    mockGet.mockResolvedValue(listResponse([mk(1, 'alert_created', 'Recovered', false)], 1, 1) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry notifications' }));
    expect(await screen.findByText('Recovered')).toBeTruthy();
  });

  it.each(['success', 'failure'])('ignores an obsolete filtered feed response (%s)', async result => {
    let resolve!: (value: ReturnType<typeof listResponse>) => void;
    let reject!: (reason: Error) => void;
    const pending = new Promise<ReturnType<typeof listResponse>>((yes, no) => { resolve = yes; reject = no; });
    mockGet.mockImplementation((_url, config) => config?.params && (config.params as { kind?: string }).kind
      ? Promise.resolve(listResponse([mk(2, 'case_mention', 'Current mention', false)], 1, 1)) as never
      : pending as never);
    renderPage();
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'case_mention' } });
    expect(await screen.findByText('Current mention')).toBeTruthy();
    await act(async () => {
      if (result === 'success') resolve(listResponse([mk(1, 'alert_created', 'Obsolete alert', false)], 1, 1));
      else reject(new Error('Old request failed'));
    });
    expect(screen.getByText('Current mention')).toBeTruthy();
    expect(screen.queryByText('Obsolete alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry notifications' })).toBeNull();
  });

});


describe('Loaded notification review', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(cleanup);
it('reviews every full saved message in a loaded group without reads or navigation', async () => {
  mockPost.mockReset();
  mockGet.mockResolvedValue(listResponse([{ ...mk(2, 'alert_updated', 'Latest update', false), body: 'Latest full evidence\nSecond retained line' }, { ...mk(1, 'alert_updated', 'Earlier update', false), body: 'Earlier full evidence' }], 42, 2) as never);
  renderPage();
  fireEvent.click(await screen.findByLabelText('Review loaded notifications: Latest update'));
  expect(screen.getByRole('region', { name: 'Saved messages: Latest update' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Earlier update' })).toBeTruthy();
  expect(screen.getByText('Earlier full evidence')).toBeTruthy();
  expect(screen.getByText(/Reading this panel does not mark them read/)).toBeTruthy();
  expect(mockPost).not.toHaveBeenCalled();
  expect(screen.getByText('2 unread')).toBeTruthy();
});

it('marks only confirmed group reads and retries only failures', async () => {
  mockPost.mockReset().mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({} as never);
  mockGet.mockResolvedValue(listResponse([mk(2, 'alert_updated', 'Grouped update', false), mk(1, 'alert_updated', 'Grouped update', false)], 2, 2) as never);
  renderPage();
  fireEvent.click(await screen.findByLabelText('Mark loaded group read: Grouped update'));
  await screen.findByRole('alert');
  expect(screen.getByText('1 unread')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Mark loaded group read: Grouped update'));
  await screen.findByText('All caught up');
  expect(mockPost.mock.calls.map(([url]) => url)).toEqual(['/notifications/2/read', '/notifications/1/read', '/notifications/1/read']);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps pending group reads unread and disables competing actions until confirmation', async () => {
  let finish!: (value: unknown) => void;
  mockPost.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mockGet.mockResolvedValue(listResponse([mk(2, 'alert_updated', 'Pending update', false)], 1, 1) as never);
  renderPage();
  fireEvent.click(await screen.findByLabelText('Mark loaded group read: Pending update'));
  expect(screen.getByText('1 unread')).toBeTruthy();
  expect(screen.getByLabelText('Mark loaded group read: Pending update')).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('Delete notification Pending update')).toHaveProperty('disabled', true);
  await act(async () => finish({}));
  expect(screen.getByText('All caught up')).toBeTruthy();
});

it('removes only successful group reads from unread-only results', async () => {
  mockPost.mockReset().mockResolvedValue({} as never);
  mockGet.mockResolvedValue(listResponse([mk(2, 'alert_updated', 'Unread group', false)], 1, 1) as never);
  renderPage();
  await screen.findByText('Unread group');
  fireEvent.click(screen.getByLabelText('Unread only'));
  await waitFor(() => expect(mockGet.mock.calls.at(-1)?.[1]).toEqual({ params: { page: 1, size: 20, unread_only: true } }));
  await screen.findByLabelText('Mark loaded group read: Unread group');
  fireEvent.click(screen.getByLabelText('Mark loaded group read: Unread group'));
  await screen.findByText('No notifications match these filters');
  expect(screen.getByText('All caught up')).toBeTruthy();
});

  it.each(['https://outside.example.test', '//outside.example.test', '/app//outside.example.test', '/app/\\outside.example.test'])('does not offer a linked-record action for unsafe destination %s', async link => {
    mockGet.mockResolvedValue(listResponse([{ ...mk(2, 'alert_updated', 'Saved review', false), link }], 1, 1) as never);
    renderPage();
    fireEvent.click(await screen.findByLabelText('Review loaded notifications: Saved review'));
    expect(screen.queryByLabelText('Open notification #2')).toBeNull();
  });

});

describe('Notification saved-message search', () => {
  beforeEach(() => { vi.resetAllMocks(); }); afterEach(cleanup);
  it('searches server-side across pages and resets pagination while keeping kind and unread filters', async () => {
    mockGet.mockResolvedValue(listResponse([mk(1, 'alert_created', 'Saved match', false)], 45, 5) as never);
    renderPage(); await screen.findByText('Saved match'); fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'case_mention' } }); fireEvent.click(screen.getByLabelText('Unread only'));
    fireEvent.change(screen.getByLabelText('Search notification text'), { target: { value: ' 100%_match ' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { page: 1, size: 20, unread_only: true, kind: 'case_mention', query: '100%_match' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { page: 2, size: 20, unread_only: true, kind: 'case_mention', query: '100%_match' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear notification search' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { page: 1, size: 20, unread_only: true, kind: 'case_mention' } }));
  });
  it('does not restore old search results after a newer search finishes', async () => {
    let finish!: (value: unknown) => void;
    mockGet.mockImplementation((_url, config) => (config?.params as {query?:string})?.query === 'old' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(listResponse([mk(2, 'alert_created', 'Current result', false)], 1, 2)) as never);
    renderPage(); await screen.findByText('Current result'); fireEvent.change(screen.getByLabelText('Search notification text'), { target: { value: 'old' } });fireEvent.change(screen.getByLabelText('Search notification text'), { target: { value: 'new' } });await screen.findByText('Current result');
    await act(async () => finish(listResponse([mk(1,'alert_created','Stale result',false)],1,2)));expect(screen.queryByText('Stale result')).toBeNull();
  });
});
