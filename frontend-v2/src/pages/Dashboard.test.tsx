import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert, AlertStats } from '../api/types';
import { Dashboard } from './Dashboard';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPatch = vi.mocked(apiClient.patch);

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

function mockAllFulfilled(alerts: Alert[] = [makeAlert()], myAlerts: Alert[] = [], myCases: Array<{ id: number; title: string; severity: string; status: string }> = [], incidents: Array<{ asset_id: number; asset_name: string; max_severity: string; alert_count: number; blast_radius: number }> = [], watchingAlerts: Alert[] = [], watchingCases: Array<{ id: number; title: string; severity: string; status: string; due_date: string | null }> = []) {
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
        if (params?.watching === 'me') {
          return Promise.resolve({ data: { alerts: watchingAlerts, total: watchingAlerts.length, page: 1, size: 5, pages: 1 } });
        }
        return Promise.resolve({ data: { alerts, total: alerts.length, page: 1, size: 50, pages: 1 } });
      case '/cases/':
        if (params?.watching === 'me') {
          return Promise.resolve({ data: { cases: watchingCases, total: watchingCases.length, page: 1, size: 5 } });
        }
        return Promise.resolve({ data: { cases: myCases, total: myCases.length, page: 1, size: 5 } });
      case '/ot/devices-by-zone':
        return Promise.resolve({ data: [] });
      case '/alerts/stats/timeline':
        return Promise.resolve({ data: { days: TIMELINE_DAYS } });
      case '/cases/my-tasks':
        return Promise.resolve({ data: [] });
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

  it('lists watched alerts and investigations with a link to the watchlist', async () => {
    mockAllFulfilled(
      [makeAlert()], [], [], [],
      [makeAlert({ id: 21, title: 'Watched vuln' })],
      [{ id: 8, title: 'Watched investigation', severity: 'critical', status: 'open', due_date: '2026-11-25' }],
    );
    renderDashboard();
    expect(await screen.findByText('Watching')).toBeTruthy();
    expect(screen.getByText('Watched vuln')).toBeTruthy();
    expect(screen.getByText('Watched investigation')).toBeTruthy();
    expect(screen.getByText(/due 2026-11-25/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View watchlist' }).getAttribute('href')).toBe('/watchlist');
  });

  it('hides the Watching panel when nothing is watched', async () => {
    mockAllFulfilled();
    renderDashboard();
    await screen.findByText('42');
    await waitFor(() => expect(screen.queryByText('Watching')).toBeNull());
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

describe('My tasks', () => {
  const myTasks = [
    { task_id: 11, case_id: 7, case_title: 'Suspicious lateral movement', case_severity: 'critical', case_status: 'investigating', case_due_date: '2026-11-25', title: 'Contain the host', due_date: null as string | null, created_at: '2026-11-18T09:00:00Z' },
    { task_id: 12, case_id: 9, case_title: 'Phishing follow-up', case_severity: 'low', case_status: 'open', case_due_date: null, title: 'Review firewall logs', due_date: null as string | null, created_at: '2026-11-18T09:05:00Z' },
  ];

  function mockWithTasks(tasks: typeof myTasks) {
    mockAllFulfilled();
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url: string, config?: unknown) => {
      if (url === '/cases/my-tasks') return Promise.resolve({ data: tasks });
      return base(url, config as Parameters<typeof base>[1]);
    });
  }

  it('lists open assigned tasks with case context and deep links', async () => {
    mockWithTasks(myTasks);
    renderDashboard();
    expect(await screen.findByText('My tasks')).toBeTruthy();
    expect(screen.getByText('Contain the host')).toBeTruthy();
    expect(screen.getByText(/Suspicious lateral movement · Investigation #7 · due 2026-11-25/)).toBeTruthy();
    expect(screen.getByText('Review firewall logs')).toBeTruthy();
    expect((screen.getByText('Contain the host').closest('a') as HTMLAnchorElement).href).toContain('/cases/7');
  });

  it('badges overdue tasks and groups rows by due window', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const inWeek = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    mockWithTasks([
      { ...myTasks[0], due_date: '2000-01-01' },
      { ...myTasks[1], title: 'Today task', task_id: 13, due_date: today },
      { ...myTasks[1], title: 'Week task', task_id: 14, due_date: inWeek },
      { ...myTasks[1], title: 'Later task', task_id: 15, due_date: later },
      { ...myTasks[1], title: 'Undated task', task_id: 16, due_date: null },
    ]);
    renderDashboard();
    expect(await screen.findByText('Task overdue · due 2000-01-01')).toBeTruthy();
    expect(screen.getByText('Overdue (1)')).toBeTruthy();
    expect(screen.getByText('Due today (1)')).toBeTruthy();
    expect(screen.getByText('Due this week (1)')).toBeTruthy();
    expect(screen.getByText('Later (1)')).toBeTruthy();
    expect(screen.getByText('No due date (1)')).toBeTruthy();
    expect((screen.getByLabelText('Due date for task Later task') as HTMLInputElement).value).toBe(later);
  });

  it('sets a task due date inline', async () => {
    mockWithTasks(myTasks);
    mockPatch.mockResolvedValue({ data: {} });
    renderDashboard();
    fireEvent.change(await screen.findByLabelText('Due date for task Contain the host'), { target: { value: '2026-12-01' } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/11', { due_date: '2026-12-01' }));
    await waitFor(() => expect((screen.getByLabelText('Due date for task Contain the host') as HTMLInputElement).value).toBe('2026-12-01'));
  });

  it('clears a task due date inline', async () => {
    mockWithTasks([{ ...myTasks[0], due_date: '2026-12-01' }]);
    mockPatch.mockResolvedValue({ data: {} });
    renderDashboard();
    fireEvent.change(await screen.findByLabelText('Due date for task Contain the host'), { target: { value: '' } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/11', { due_date: null }));
  });

  it('shows a failed date save without changing the saved date, then permits retry', async () => {
    mockWithTasks([{ ...myTasks[0], due_date: '2026-12-01' }]);
    mockPatch.mockRejectedValueOnce(new Error('unavailable'));
    renderDashboard();
    const input = await screen.findByLabelText('Due date for task Contain the host');
    fireEvent.change(input, { target: { value: '2026-12-02' } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('2026-12-01');
    mockPatch.mockResolvedValueOnce({ data: {} });
    fireEvent.change(input, { target: { value: '2026-12-03' } });
    await waitFor(() => expect((screen.getByLabelText('Due date for task Contain the host') as HTMLInputElement).value).toBe('2026-12-03'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks overlapping date saves and completion while a task save is pending', async () => {
    mockWithTasks(myTasks);
    let rejectSave!: (reason: Error) => void;
    mockPatch.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    renderDashboard();
    const input = await screen.findByLabelText('Due date for task Contain the host');
    fireEvent.change(input, { target: { value: '2026-12-02' } });
    expect((screen.getByLabelText('Due date for task Review firewall logs') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Complete task Contain the host' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '2026-12-03' } });
    expect(mockPatch).toHaveBeenCalledTimes(1);
    rejectSave(new Error('unavailable'));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Due date for task Review firewall logs') as HTMLInputElement).disabled).toBe(false);
  });

  it('hides the panel when no tasks are assigned', async () => {
    mockWithTasks([]);
    renderDashboard();
    await screen.findByText('Total alerts');
    await waitFor(() => expect(screen.queryByText('My tasks')).toBeNull());
  });
});

describe('My tasks inline completion', () => {
  const tasks = [
    { task_id: 11, case_id: 7, case_title: 'Suspicious lateral movement', case_severity: 'critical', case_status: 'investigating', case_due_date: '2026-11-25', title: 'Contain the host', due_date: null as string | null, created_at: '2026-11-18T09:00:00Z' },
    { task_id: 12, case_id: 9, case_title: 'Phishing follow-up', case_severity: 'low', case_status: 'open', case_due_date: null, title: 'Review firewall logs', due_date: null as string | null, created_at: '2026-11-18T09:05:00Z' },
  ];

  function mockWithTasks() {
    mockAllFulfilled();
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url: string, config?: unknown) => {
      if (url === '/cases/my-tasks') return Promise.resolve({ data: tasks });
      return base(url, config as Parameters<typeof base>[1]);
    });
  }

  it('completes a task from the panel and removes its row', async () => {
    mockWithTasks();
    mockPatch.mockResolvedValue({ data: { done: true } });
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: 'Complete task Contain the host' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/11', { done: true }));
    await waitFor(() => expect(screen.queryByText('Contain the host')).toBeNull());
    expect(screen.getByText('Review firewall logs')).toBeTruthy();
  });

  it('keeps the row when completion fails', async () => {
    mockWithTasks();
    mockPatch.mockRejectedValue(new Error('boom'));
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: 'Complete task Contain the host' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    expect(screen.getByText('Contain the host')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});


it('keeps assigned tasks visible as unavailable on failure and recovers on retry', async () => {
  const base = mockGet.getMockImplementation()!;
  let fail = true;
  mockGet.mockImplementation((url, config) => {
    if (url === '/cases/my-tasks') {
      if (fail) return Promise.reject(new Error('Offline'));
      return Promise.resolve({ data: [{ task_id: 91, case_id: 7, case_title: 'Edge investigation', case_severity: 'high', case_status: 'open', case_due_date: null, title: 'Collect host evidence', due_date: null, created_at: '2026-11-19T08:00:00Z' }] });
    }
    return base(url, config);
  });
  renderDashboard();
  await screen.findByText('Assigned tasks unavailable');
  expect(screen.getByRole('region', { name: 'My tasks' })).toBeTruthy();
  expect(screen.queryByText('No checklist tasks assigned to you.')).toBeNull();
  expect(screen.getByText('Test vulnerability')).toBeTruthy();
  fail = false;
  const region = screen.getByRole('region', { name: 'My tasks' });
  fireEvent.click(region.querySelector('button')!);
  await screen.findByText('Collect host evidence');
  expect(screen.queryByText('Assigned tasks unavailable')).toBeNull();
});
