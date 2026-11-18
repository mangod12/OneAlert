import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert, AlertStats } from '../api/types';
import { Dashboard } from './Dashboard';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    user_id: 5,
    cve_id: 'CVE-2026-0001',
    title: 'Test vulnerability',
    description: 'A test description',
    severity: 'critical',
    status: 'pending',
    source: 'NVD',
    cvss_score: 9.8,
    asset_id: 10,
    asset_name: 'edge-router-01',
    asset_vendor: 'Acme',
    asset_product: 'RouterOS',
    remediation: null,
    created_at: '2026-11-10T08:00:00Z',
    acknowledged_at: null, assigned_to_id: null, assigned_to_email: null,
    ...overrides,
  };
}

const TIMELINE_DAYS = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, '0')}`,
  critical: i === 13 ? 2 : 0,
  high: i === 13 ? 1 : 0,
  medium: 0,
  low: 0,
}));

const STATS: AlertStats = {
  total_alerts: 42,
  critical_alerts: 3,
  high_alerts: 7,
  medium_alerts: 12,
  low_alerts: 20,
  pending_alerts: 5,
  acknowledged_alerts: 2,
};

function mockAllFulfilled(alerts: Alert[] = [makeAlert()], myAlerts: Alert[] = [], myCases: Array<{ id: number; title: string; severity: string; status: string }> = [], incidents: Array<{ asset_id: number; asset_name: string; max_severity: string; alert_count: number; blast_radius: number }> = []) {
  mockGet.mockImplementation((url: string, config?: unknown) => {
    const params = (config as { params?: Record<string, unknown> } | undefined)?.params;
    switch (url) {
      case '/alerts/stats/overview':
        return Promise.resolve({ data: STATS });
      case '/assets/':
        return Promise.resolve({ data: { total: 12 } });
      case '/ot/discovered-devices':
        return Promise.resolve({ data: { total: 34 } });
      case '/alerts/':
        if (params?.assigned === 'me') {
          return Promise.resolve({ data: { alerts: myAlerts, total: myAlerts.length, page: 1, size: 5, pages: 1 } });
        }
        return Promise.resolve({ data: { alerts, total: alerts.length, page: 1, size: 50, pages: 1 } });
      case '/cases/':
        return Promise.resolve({ data: { cases: myCases, total: myCases.length, page: 1, size: 5 } });
      case '/ot/devices-by-zone':
        return Promise.resolve({ data: [] });
      case '/alerts/stats/timeline':
        return Promise.resolve({ data: { days: TIMELINE_DAYS } });
      case '/incidents':
        return Promise.resolve({ data: { total: incidents.length, incidents } });
      case '/alerts/stats/response-metrics':
        return Promise.resolve({ data: { days: 30, acknowledged_count: 8, resolved_count: 5, mtta_seconds: 5400, mttr_seconds: 18000 } });
      default:
        return Promise.reject(new Error(`unexpected url ${url}`));
    }
  });
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockAllFulfilled();
});

describe('Dashboard page', () => {
  it('renders KPI values and priority alerts after loading', async () => {
    renderDashboard();
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.getByText('Total alerts')).toBeTruthy();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('34').length).toBeGreaterThan(0);
    expect(screen.getByText('Test vulnerability')).toBeTruthy();
  });

  it('shows a full error state and retries when every request fails', async () => {
    mockGet.mockReset();
    mockGet.mockRejectedValue({ isAxiosError: true, response: { status: 500, data: {} } });
    renderDashboard();
    expect(await screen.findByText('Command data could not be loaded')).toBeTruthy();

    mockAllFulfilled();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('42')).toBeTruthy();
  });

  it('shows a degraded banner when only some requests fail', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/alerts/stats/overview') {
        return Promise.reject({ isAxiosError: true, response: { status: 500, data: {} } });
      }
      if (url === '/alerts/') {
        return Promise.resolve({ data: { alerts: [], total: 0, page: 1, size: 50, pages: 1 } });
      }
      if (url === '/assets/') return Promise.resolve({ data: { total: 12 } });
      if (url === '/ot/discovered-devices') return Promise.resolve({ data: { total: 34 } });
      return Promise.resolve({ data: [] });
    });
    renderDashboard();
    expect(await screen.findByText('Some live data is unavailable')).toBeTruthy();
    expect(screen.getAllByText('Managed assets').length).toBeGreaterThan(0);
  });

  it('limits the priority hub to four critical or high alerts', async () => {
    const alerts = Array.from({ length: 6 }, (_, i) =>
      makeAlert({ id: i + 1, title: `Priority ${i + 1}`, severity: i % 2 === 0 ? 'critical' : 'high' })
    );
    alerts.push(makeAlert({ id: 99, title: 'Medium noise', severity: 'medium' }));
    mockAllFulfilled(alerts);
    renderDashboard();
    expect(await screen.findByText('Priority 1')).toBeTruthy();
    expect(screen.getByText('Priority 4')).toBeTruthy();
    expect(screen.queryByText('Priority 5')).toBeNull();
    expect(screen.queryByText('Medium noise')).toBeNull();
  });

  it('uses the server 14-day timeline for the alert activity chart', async () => {
    renderDashboard();
    expect(await screen.findByText('Alert activity · 14 days')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/alerts/stats/timeline', { params: { days: 14 } });
    expect(await screen.findByRole('img', { name: /Alert activity over the last 14 days/ })).toBeTruthy();
  });

  it('renders the chart panels', async () => {
    renderDashboard();
    expect(await screen.findByText('Severity distribution')).toBeTruthy();
    expect(screen.getByText('Alert activity · 14 days')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('42')).toBeTruthy();
    });
  });
});

describe('My assignments', () => {
  it('lists alerts and investigations assigned to the current user', async () => {
    mockAllFulfilled(
      [makeAlert()],
      [makeAlert({ id: 9, title: 'Assigned critical vuln' })],
      [{ id: 7, title: 'Assigned investigation', severity: 'high', status: 'investigating' }],
    );
    renderDashboard();
    expect(await screen.findByText('My assignments')).toBeTruthy();
    expect(screen.getByText('Assigned critical vuln')).toBeTruthy();
    expect(screen.getByText('Assigned investigation')).toBeTruthy();
    expect(screen.getByText('investigating')).toBeTruthy();
  });

  it('hides the panel when nothing is assigned', async () => {
    mockAllFulfilled([makeAlert()], [], []);
    renderDashboard();
    await screen.findByText('42');
    await waitFor(() => expect(screen.queryByText('My assignments')).toBeNull());
  });


  it('shows the active incidents panel when incidents exist', async () => {
    mockAllFulfilled([makeAlert()], [], [], [
      { asset_id: 5, asset_name: 'plc-01', max_severity: 'critical', alert_count: 3, blast_radius: 2 },
    ]);
    renderDashboard();
    expect(await screen.findByText('Active incidents')).toBeTruthy();
    expect(screen.getByText('plc-01')).toBeTruthy();
    expect(screen.getByText(/3 active alerts/)).toBeTruthy();
  });

  it('hides the incidents panel when nothing correlates', async () => {
    mockAllFulfilled();
    renderDashboard();
    await screen.findByText('42');
    expect(screen.queryByText('Active incidents')).toBeNull();
  });
});
