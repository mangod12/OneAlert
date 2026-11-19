import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from '../../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockDelete = vi.mocked(apiClient.delete);

function listResponse(items: unknown[], unread: number) {
  return { data: { success: true, data: items, total: items.length, unread_count: unread } };
}

const sample = [
  {
    id: 11,
    kind: 'alert_created',
    title: 'New critical alert on PLC-01',
    body: 'CVE-2026-0001 detected',
    link: '/app/alerts',
    read_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 10,
    kind: 'case_assigned',
    title: 'Case #4 assigned to you',
    body: 'Suspicious Modbus burst',
    link: '/app/cases/4',
    read_at: '2026-11-18T00:00:00Z',
    created_at: '2026-11-18T00:00:00Z',
  },
];

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('shows the unread count from the badge poll', async () => {
    mockGet.mockResolvedValue(listResponse([], 3) as never);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    expect(await screen.findByText('3')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/notifications/', { params: { size: 1 } });
  });

  it('hides the badge when nothing is unread', async () => {
    mockGet.mockResolvedValue(listResponse([], 0) as never);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('loads recent notifications when opened and marks all read', async () => {
    mockGet
      .mockResolvedValueOnce(listResponse([], 2) as never)
      .mockResolvedValueOnce(listResponse(sample, 2) as never);
    mockPost.mockResolvedValue({ data: { success: true, marked: 2 } } as never);

    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('New critical alert on PLC-01')).toBeTruthy();
    expect(screen.getByText('Case #4 assigned to you')).toBeTruthy();

    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/notifications/read-all'));
    expect(screen.queryByText('2')).toBeNull();
  });

  it('marks an unread item read and navigates to its link', async () => {
    mockGet
      .mockResolvedValueOnce(listResponse([], 1) as never)
      .mockResolvedValueOnce(listResponse(sample.slice(0, 1), 1) as never);
    mockPost.mockResolvedValue({ data: { success: true } } as never);

    render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationBell />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    fireEvent.click(await screen.findByText('New critical alert on PLC-01'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/notifications/11/read'));
  });

  it('deletes a single notification from the list', async () => {
    mockGet
      .mockResolvedValueOnce(listResponse([], 1) as never)
      .mockResolvedValueOnce(listResponse(sample, 1) as never);
    mockDelete.mockResolvedValue({ data: { success: true } } as never);

    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Case #4 assigned to you')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete notification Case #4 assigned to you' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/notifications/10'));
    await waitFor(() => expect(screen.queryByText('Case #4 assigned to you')).toBeNull());
    expect(screen.getByText('New critical alert on PLC-01')).toBeTruthy();
  });

  it('clears read notifications and keeps unread ones', async () => {
    mockGet
      .mockResolvedValueOnce(listResponse([], 1) as never)
      .mockResolvedValueOnce(listResponse(sample, 1) as never);
    mockDelete.mockResolvedValue({ data: { success: true, deleted: 1 } } as never);

    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Case #4 assigned to you')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /clear read/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/notifications/read'));
    await waitFor(() => expect(screen.queryByText('Case #4 assigned to you')).toBeNull());
    expect(screen.getByText('New critical alert on PLC-01')).toBeTruthy();
  });

  it('shows an empty state when there are no notifications', async () => {
    mockGet
      .mockResolvedValueOnce(listResponse([], 0) as never)
      .mockResolvedValueOnce(listResponse([], 0) as never);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
  });
});

describe('notification grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  const dup = (id: number, read: boolean) => ({
    id,
    kind: 'alert_updated',
    title: 'Alert #7 was resolved',
    body: 'RouterOS RCE',
    link: '/app/alerts?alert=7',
    read_at: read ? '2026-11-18T00:00:00Z' : null,
    created_at: new Date().toISOString(),
  });

  const open = async (items: unknown[], unread: number) => {
    mockGet
      .mockResolvedValueOnce(listResponse([], unread) as never)
      .mockResolvedValueOnce(listResponse(items, unread) as never);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(await screen.findByLabelText(/Notifications/));
    await screen.findByText('Alert #7 was resolved');
  };

  it('collapses consecutive same-kind same-link notifications with a count', async () => {
    await open([dup(3, false), dup(2, false), dup(1, true)], 2);
    expect(screen.getAllByText('Alert #7 was resolved')).toHaveLength(1);
    expect(screen.getByText('×3')).toBeTruthy();
  });

  it('does not collapse different kinds or links', async () => {
    mockGet
      .mockResolvedValueOnce(listResponse([], 1) as never)
      .mockResolvedValueOnce(listResponse([dup(2, false), { ...dup(1, false), kind: 'case_updated', title: 'Case #4 updated' }], 2) as never);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(await screen.findByLabelText(/Notifications/));
    await screen.findByText('Alert #7 was resolved');
    expect(screen.getByText('Case #4 updated')).toBeTruthy();
    expect(screen.queryByText(/×\d/)).toBeNull();
  });

  it('marks every unread item in the group read when opened', async () => {
    await open([dup(2, false), dup(1, false)], 2);
    fireEvent.click(screen.getByText('Alert #7 was resolved'));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/notifications/2/read');
      expect(mockPost).toHaveBeenCalledWith('/notifications/1/read');
    });
  });

  it('deletes the whole group', async () => {
    mockDelete.mockResolvedValue({} as never);
    await open([dup(2, false), dup(1, true)], 1);
    fireEvent.click(screen.getByLabelText('Delete 2 notifications: Alert #7 was resolved'));
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/notifications/2');
      expect(mockDelete).toHaveBeenCalledWith('/notifications/1');
    });
    await waitFor(() => expect(screen.queryByText('Alert #7 was resolved')).toBeNull());
  });
});
