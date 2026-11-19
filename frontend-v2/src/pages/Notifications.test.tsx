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

  it('marks all read', async () => {
    mockGet.mockResolvedValue(listResponse([mk(1, 'alert_created', 'New alert', false)], 1, 1) as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Mark all read/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/notifications/read-all'));
    expect(await screen.findByText('All caught up')).toBeTruthy();
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
  it('keeps unread counts and shows an error when mark all read fails', async () => {
    mockGet.mockResolvedValue(listResponse([mk(1, 'alert_created', 'New alert', false)], 1, 1) as never);
    mockPost.mockRejectedValueOnce(new Error('Offline'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('1 unread')).toBeTruthy();
    expect(screen.getByText('New alert')).toBeTruthy();
  });

  it('keeps read items visible until clear succeeds and exposes failures', async () => {
    mockGet.mockResolvedValue(listResponse([mk(1, 'case_assigned', 'Read item', true)], 1, 0) as never);
    mockDelete.mockRejectedValueOnce(new Error('Offline'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear read' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Read item')).toBeTruthy();
    expect(mockDelete).toHaveBeenCalledWith('/notifications/read');
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

  it('guards duplicate mutations while saving', async () => {
    let resolve!: (value: never) => void;
    mockGet.mockResolvedValue(listResponse([mk(1, 'alert_created', 'New alert', false)], 1, 1) as never);
    mockPost.mockImplementation(() => new Promise(r => { resolve = r; }));
    renderPage();
    const button = await screen.findByRole('button', { name: 'Mark all read' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Unread only') as HTMLInputElement).disabled).toBe(true);
    await act(async () => resolve({} as never));
    expect(await screen.findByText('All caught up')).toBeTruthy();
  });

});
