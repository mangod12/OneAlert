import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Reports } from './Reports';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const report = {
  days: 30,
  generated_at: '2026-11-18T18:00:00Z',
  alerts: {
    opened: 9,
    acknowledged: 5,
    resolved: 4,
    by_severity: { critical: 2, high: 3, medium: 3, low: 1 },
    mtta_seconds: 5400,
    mttr_seconds: 28800,
  },
  incidents: {
    active: 2,
    critical: 1,
    top_assets: [
      { asset_id: 11, asset_name: 'plant-historian', alert_count: 3, max_severity: 'critical' },
      { asset_id: 12, asset_name: 'edge-router', alert_count: 2, max_severity: 'high' },
    ],
  },
  cases: { open: 2, in_progress: 1, closed: 6, opened: 3 },
};

const slaReport = {
  days: 30,
  alerts: {
    due: 4,
    met: 3,
    breached: 1,
    upcoming: 2,
    attainment_pct: 75.0,
    by_severity: {
      critical: { due: 2, met: 2, breached: 0 },
      high: { due: 1, met: 0, breached: 1 },
      medium: { due: 1, met: 1, breached: 0 },
      low: { due: 0, met: 0, breached: 0 },
    },
  },
  cases: {
    due: 3,
    met: 3,
    breached: 0,
    upcoming: 0,
    attainment_pct: 100.0,
    by_severity: {
      critical: { due: 1, met: 1, breached: 0 },
      high: { due: 1, met: 1, breached: 0 },
      medium: { due: 1, met: 1, breached: 0 },
      low: { due: 0, met: 0, breached: 0 },
    },
  },
};

function mockApis(posture: unknown = report, sla: unknown = slaReport) {
  get.mockImplementation(async (url: string) => {
    if (url === '/reports/sla') return { data: sla };
    return { data: posture };
  });
}

function renderPage() {
  return render(<MemoryRouter><Reports /></MemoryRouter>);
}

describe('Reports', () => {
  it('renders response metrics and window totals', async () => {
    mockApis();
    renderPage();
    expect(await screen.findByText('Posture report')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/reports/posture', { params: { days: 30 } });
    expect(get).toHaveBeenCalledWith('/reports/sla', { params: { days: 30 } });
    expect(screen.getByText('9')).toBeTruthy(); // alerts opened
    expect(screen.getByText('5 acknowledged · 30d')).toBeTruthy();
    expect(screen.getByText('4 resolved · 30d')).toBeTruthy();
    expect(screen.getByText('1 at critical severity')).toBeTruthy();
  });

  it('shows the severity breakdown and top risk assets', async () => {
    mockApis();
    renderPage();
    expect(await screen.findByText('Alert volume by severity')).toBeTruthy();
    expect(screen.getByText('plant-historian')).toBeTruthy();
    expect(screen.getByText('edge-router')).toBeTruthy();
    expect(screen.getByText('3 active alerts')).toBeTruthy();
    expect((screen.getByText('Open incidents') as HTMLAnchorElement).href).toContain('/incidents');
  });

  it('shows investigation counts', async () => {
    mockApis();
    renderPage();
    expect((await screen.findAllByText('Investigations')).length).toBeGreaterThan(0);
    expect(screen.getByText('Open now')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Opened in 30d')).toBeTruthy();
    expect(screen.getByText('Closed overall')).toBeTruthy();
  });

  it('renders SLA compliance for alerts and investigations', async () => {
    mockApis();
    renderPage();
    expect(await screen.findByText('SLA compliance')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy(); // alert attainment
    expect(screen.getByText('100%')).toBeTruthy(); // investigation attainment
    expect(screen.getByText('3 met · 1 breached · 2 upcoming')).toBeTruthy();
    expect(screen.getByText('2/2 met')).toBeTruthy(); // critical alert row
    expect(screen.getByRole('button', { name: /Export SLA CSV/ })).toBeTruthy();
  });

  it('shows the SLA empty state when nothing was due in the window', async () => {
    mockApis(report, {
      days: 30,
      alerts: { due: 0, met: 0, breached: 0, upcoming: 1, attainment_pct: null, by_severity: slaReport.alerts.by_severity },
      cases: { due: 0, met: 0, breached: 0, upcoming: 0, attainment_pct: null, by_severity: slaReport.cases.by_severity },
    });
    renderPage();
    expect(await screen.findByText('SLA compliance')).toBeTruthy();
    expect(screen.getAllByText('No due dates in window')).toHaveLength(2);
  });

  it('switches the trailing window', async () => {
    mockApis({ ...report, days: 7 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '7 days' }));
    expect(get).toHaveBeenCalledWith('/reports/posture', { params: { days: 7 } });
    expect(get).toHaveBeenCalledWith('/reports/sla', { params: { days: 7 } });
  });

  it('shows the empty state when no assets are at risk', async () => {
    mockApis({ ...report, incidents: { active: 0, critical: 0, top_assets: [] } });
    renderPage();
    expect(await screen.findByText(/No active incidents/)).toBeTruthy();
  });

  it('shows the error state when loading fails and retries', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Report unavailable')).toBeTruthy();
    mockApis();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('plant-historian')).toBeTruthy();
  });
});
