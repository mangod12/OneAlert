import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Incidents } from './Incidents';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const incident = {
  asset_id: 5, asset_name: 'plc-01', asset_vendor: 'Acme', asset_product: 'PLC-300',
  asset_criticality: 'critical', max_severity: 'critical', alert_count: 3,
  shared_cves: ['CVE-2026-1001', 'CVE-2026-1002'],
  first_seen: '2026-11-17T08:00:00Z', last_seen: '2026-11-18T09:00:00Z',
  blast_radius: 2,
  linked_cases: [{ id: 9, title: 'PLC compromise', status: 'open' }],
  alerts: [
    { id: 11, cve_id: 'CVE-2026-1001', title: 'Modbus coil write', severity: 'critical', status: 'pending', created_at: '2026-11-17T08:00:00Z' },
    { id: 12, cve_id: 'CVE-2026-1002', title: 'Firmware backdoor', severity: 'high', status: 'acknowledged', created_at: '2026-11-18T09:00:00Z' },
  ],
};

function mockGets(timeline: unknown[] = []) {
  get.mockImplementation(async (url: string) => {
    if (url === '/incidents') return { data: { total: 1, incidents: [incident] } };
    if (url === '/incidents/5/timeline') return { data: { asset_id: 5, asset_name: 'plc-01', events: timeline } };
    throw new Error(`unexpected ${url}`);
  });
}

function renderPage() {
  return render(<MemoryRouter><Incidents /></MemoryRouter>);
}

describe('Incidents', () => {
  it('lists correlated incidents with severity and blast radius', async () => {
    mockGets();
    renderPage();
    expect(await screen.findByText('plc-01')).toBeTruthy();
    expect(screen.getByText('critical')).toBeTruthy();
    expect(screen.getByText(/3 active alerts/)).toBeTruthy();
    expect(screen.getByText(/blast radius 2 connections/)).toBeTruthy();
    expect(screen.getByText(/CVE-2026-1001/)).toBeTruthy();
  });

  it('expands to show alerts, linked cases and the timeline', async () => {
    mockGets([
      { kind: 'alert_updated', alert_id: 11, title: 'Modbus coil write', detail: 'status: pending -> acknowledged', timestamp: '2026-11-18T10:00:00Z' },
      { kind: 'alert_created', alert_id: 11, title: 'Modbus coil write', detail: 'critical severity', timestamp: '2026-11-17T08:00:00Z' },
    ]);
    renderPage();
    fireEvent.click(await screen.findByText('plc-01'));
    expect(await screen.findByText('Modbus coil write')).toBeTruthy();
    expect(screen.getByText('PLC compromise')).toBeTruthy();
    expect(await screen.findByText('Alert updated')).toBeTruthy();
    expect(screen.getByText(/status: pending -> acknowledged/)).toBeTruthy();
    expect((screen.getByText('View these alerts in the alert list') as HTMLAnchorElement).href).toContain('/alerts?asset_id=5');
  });

  it('shows the empty state when nothing correlates', async () => {
    get.mockResolvedValue({ data: { total: 0, incidents: [] } });
    renderPage();
    expect(await screen.findByText('No incidents')).toBeTruthy();
  });

  it('shows the error state when loading fails', async () => {
    get.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Incidents unavailable')).toBeTruthy();
  });
});
