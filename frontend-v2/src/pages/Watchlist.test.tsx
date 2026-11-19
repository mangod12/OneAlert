import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Watchlist } from './Watchlist';

vi.mock('../api/client', () => ({
  SESSION_EXPIRED_EVENT: 'onealert:session-expired',
  default: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockDelete = vi.mocked(apiClient.delete);

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 5,
    cve_id: 'CVE-2026-0001',
    title: 'RouterOS remote code execution',
    severity: 'high',
    status: 'pending',
    asset_name: 'edge-router-01',
    created_at: '2026-11-10T08:00:00Z',
    ...overrides,
  };
}

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    title: 'Intrusion on the edge network',
    severity: 'critical',
    status: 'open',
    created_at: '2026-11-12T08:00:00Z',
    due_date: null,
    ...overrides,
  };
}

function mockFeed(alerts: unknown[] = [], cases: unknown[] = []) {
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/alerts/') return { data: { alerts, total: alerts.length, page: 1, size: 50, pages: 1 } };
    if (url === '/cases/') return { data: { cases, total: cases.length, page: 1, pages: 1 } };
    return { data: [] };
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockFeed([makeAlert()], [makeCase()]);
  mockDelete.mockResolvedValue({ data: {} });
});

describe('Watchlist page', () => {
  it('asks both endpoints for watched items', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Intrusion on the edge network');
    expect(mockGet).toHaveBeenCalledWith('/alerts/', { params: { watching: 'me', size: 50 } });
    expect(mockGet).toHaveBeenCalledWith('/cases/', { params: { watching: 'me', size: 50 } });
  });

  it('merges alerts and investigations ranked by severity', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Intrusion on the edge network');
    const rows = screen.getAllByRole('row').slice(1); // skip the header row
    expect(rows[0].textContent).toContain('Intrusion on the edge network'); // critical case first
    expect(rows[1].textContent).toContain('CVE-2026-0001 - RouterOS remote code execution'); // high alert second
    expect(rows[1].textContent).toContain('edge-router-01');
  });

  it('marks overdue investigations', async () => {
    mockFeed([], [makeCase({ due_date: '2020-01-01' })]);
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText(/Due 2020-01-01 \(overdue\)/);
  });

  it('shows the empty state when nothing is watched', async () => {
    mockFeed([], []);
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Nothing on your watchlist');
  });

  it('shows the error state and retries', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Watchlist unavailable');
    mockFeed([makeAlert()], []);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await screen.findByText(/CVE-2026-0001/);
  });

  it('unwatches an alert from the list', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText(/CVE-2026-0001/);
    fireEvent.click(screen.getByRole('button', { name: /unwatch CVE-2026-0001/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/alerts/1/watch'));
    await waitFor(() => expect(screen.queryByText(/CVE-2026-0001/)).toBeNull());
    // The investigation stays on the list.
    screen.getByText('Intrusion on the edge network');
  });

  it('unwatches an investigation from the list', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Intrusion on the edge network');
    fireEvent.click(screen.getByRole('button', { name: /unwatch Intrusion/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/3/watch'));
    await waitFor(() => expect(screen.queryByText('Intrusion on the edge network')).toBeNull());
  });

  it('keeps the row when unwatching fails', async () => {
    mockDelete.mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText(/CVE-2026-0001/);
    fireEvent.click(screen.getByRole('button', { name: /unwatch CVE-2026-0001/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    await screen.findByText(/CVE-2026-0001/);
  });

  it('deep-links alert rows to the alerts page and case rows to the investigation', async () => {
    render(
      <MemoryRouter initialEntries={['/watchlist']}>
        <Routes>
          <Route path="*" element={<><Watchlist /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    );
    const caseName = await screen.findByText('Intrusion on the edge network');
    fireEvent.click(caseName.closest('tr')!);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/cases/3'));
  });
});
