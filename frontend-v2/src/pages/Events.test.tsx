import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from './Events';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

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
    expect(screen.getByRole('button', { name: /^high/i }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^high/i }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(10);
      expect(mockGet).toHaveBeenNthCalledWith(8, '/events/', { params: { page: 1, size: 50 } });
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

describe('Event upload', () => {
  function mockStream() {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/events/') return { data: { events: [], total: 0 } };
      if (url === '/events/stats') return { data: { data: { total_events: 0, by_severity: {}, by_type: {}, source_count: 0 } } };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('uploads the chosen file as multipart with the source type and refreshes', async () => {
    mockStream();
    mockPost.mockResolvedValue({ data: { success: true, data: { ingested: 42, skipped: 1, redacted: 0, source_id: 3 } } });
    render(<Events />);
    await screen.findByText(/No events ingested yet/);
    fireEvent.click(screen.getByRole('button', { name: /upload events/i }));
    const file = new File(['{"event_type":"alert"}\n'], 'eve.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Log file'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'zeek' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe('/events/upload');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBe(file);
    expect(config).toMatchObject({ params: { source_type: 'zeek' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockGet.mock.calls.filter(([u]) => u === '/events/').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the dialog open and posts nothing without a file', async () => {
    mockStream();
    render(<Events />);
    await screen.findByText(/No events ingested yet/);
    fireEvent.click(screen.getByRole('button', { name: /upload events/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('Choose a file to upload.')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Event type filter', () => {
  it('populates types from the API and filters the event list', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/events/') return { data: { events: [makeEvent()], total: 1 } };
      if (url === '/events/stats') return { data: { data: STATS } };
      if (url === '/events/types') return { data: { types: ['port_scan', 'dns'] } };
      throw new Error(`unexpected ${url}`);
    });
    render(<Events />);
    await screen.findByText('ET SCAN SSH brute force');
    const select = await screen.findByLabelText('Filter by event type');
    fireEvent.change(select, { target: { value: 'port_scan' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, event_type: 'port_scan' } });
    });
  });
});

describe('IP search', () => {
  it('sends the ip param and resets pagination', async () => {
    render(<Events />);
    await screen.findByText('ET SCAN SSH brute force');
    fireEvent.change(screen.getByLabelText('Search by IP address'), { target: { value: '10.0.0' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, ip: '10.0.0' } });
    });
  });
});

describe('Sensor filter', () => {
  it('offers the distinct sensor types and filters the list', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/events/') return { data: { events: [makeEvent()], total: 1 } };
      if (url === '/events/stats') return { data: { data: STATS } };
      if (url === '/events/sources') return { data: [
        { id: 1, name: 'dmz-suricata', source_type: 'suricata', status: 'active', event_count: 1200, last_event_at: null, created_at: '2026-11-01T00:00:00Z' },
        { id: 2, name: 'zeek-default', source_type: 'zeek', status: 'active', event_count: 40, last_event_at: null, created_at: '2026-11-02T00:00:00Z' },
      ] };
      throw new Error(`unexpected ${url}`);
    });
    render(<Events />);
    const select = await screen.findByLabelText('Filter by sensor type');
    fireEvent.change(select, { target: { value: 'zeek' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/events/', { params: { page: 1, size: 50, source_type: 'zeek' } });
    });
  });
});

describe('Telemetry sources', () => {
  it('lists sources with counts, last-seen and status', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/events/') return { data: { events: [], total: 0 } };
      if (url === '/events/stats') return { data: { data: { total_events: 2, by_severity: {}, by_type: {}, source_count: 2 } } };
      if (url === '/events/sources') return { data: [
        { id: 1, name: 'dmz-suricata', source_type: 'suricata', status: 'active', event_count: 1200, last_event_at: '2026-11-17T07:55:00Z', created_at: '2026-11-01T00:00:00Z' },
        { id: 2, name: 'zeek-default', source_type: 'zeek', status: 'paused', event_count: 40, last_event_at: null, created_at: '2026-11-02T00:00:00Z' },
      ] };
      throw new Error(`unexpected ${url}`);
    });
    render(<Events />);
    await screen.findByText('dmz-suricata');
    expect(screen.getByText('zeek-default')).toBeTruthy();
    expect(screen.getByText(/suricata · 1200 events · last seen/)).toBeTruthy();
    expect(screen.getByText(/zeek · 40 events · no events yet/)).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
    expect(screen.getByText('paused')).toBeTruthy();
  });
});
