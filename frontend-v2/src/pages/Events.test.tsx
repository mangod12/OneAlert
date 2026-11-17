import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from './Events';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);

interface SecurityEvent {
  id: number;
  timestamp: string;
  event_type: string;
  severity: string;
  source_ip: string | null;
  source_port: number | null;
  dest_ip: string | null;
  dest_port: number | null;
  protocol: string | null;
  signature: string | null;
  category: string | null;
  source_type: string | null;
}

function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 1,
    timestamp: '2026-11-17T08:00:00Z',
    event_type: 'alert',
    severity: 'high',
    source_ip: '10.0.0.8',
    source_port: 4444,
    dest_ip: '192.168.1.10',
    dest_port: 22,
    protocol: 'tcp',
    signature: 'ET SCAN SSH brute force',
    category: 'network',
    source_type: 'suricata',
    ...overrides,
  };
}

const STATS = {
  total_events: 120,
  by_severity: { critical: 2, high: 8, medium: 30, low: 40, info: 40 },
  by_type: { alert: 80, anomaly: 40 },
  source_count: 3,
};

function mockAllFulfilled(events: SecurityEvent[] = [makeEvent()]) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/events/') return Promise.resolve({ data: { events, total: events.length } });
    if (url === '/events/stats') return Promise.resolve({ data: { data: STATS } });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockAllFulfilled();
});

describe('Events page', () => {
  it('renders events and severity stats after loading', async () => {
    render(<Events />);
    expect(await screen.findByText('ET SCAN SSH brute force')).toBeTruthy();
    expect(screen.getByText('10.0.0.8:4444')).toBeTruthy();
    expect(screen.getByText('suricata')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('applies and clears the severity filter from the stat chips', async () => {
    render(<Events />);
    await screen.findByText('ET SCAN SSH brute force');
    fireEvent.click(screen.getByRole('button', { name: /^high/i }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, severity: 'high' } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^high/i }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(6);
      expect(mockGet).toHaveBeenNthCalledWith(5, '/events/', { params: { page: 1, size: 50 } });
    });
  });

  it('shows an error state when the stream fails and retries', async () => {
    mockGet.mockReset();
    mockGet.mockRejectedValue({ isAxiosError: true, response: { status: 500, data: {} } });
    render(<Events />);
    expect(await screen.findByText('Event stream unavailable')).toBeTruthy();

    mockAllFulfilled();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('ET SCAN SSH brute force')).toBeTruthy();
  });

  it('shows the empty state when no events exist', async () => {
    mockAllFulfilled([]);
    render(<Events />);
    expect(await screen.findByText('No events ingested yet')).toBeTruthy();
  });

  it('shows a degraded banner when stats fail but events load', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/events/') return Promise.resolve({ data: { events: [makeEvent()], total: 1 } });
      return Promise.reject({ isAxiosError: true, response: { status: 500, data: {} } });
    });
    render(<Events />);
    expect(await screen.findByText('ET SCAN SSH brute force')).toBeTruthy();
    expect(screen.getByText('Some live data is unavailable')).toBeTruthy();
  });
});
