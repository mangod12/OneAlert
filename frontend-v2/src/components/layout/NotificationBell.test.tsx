import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

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

  it('shows an empty state when there are no notifications', async () => {
    mockGet
      .mockResolvedValueOnce(listResponse([], 0) as never)
      .mockResolvedValueOnce(listResponse([], 0) as never);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
  });
});
