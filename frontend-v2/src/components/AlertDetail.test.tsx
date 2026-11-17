import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import type { Alert } from '../api/types';
import { AlertDetail } from './AlertDetail';

vi.mock('../api/client', () => ({ default: {
  get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
} }));

const alert: Alert = {
  id: 1, cve_id: 'CVE-2026-0001', title: 'RouterOS RCE', description: 'Remote code execution.',
  severity: 'critical', status: 'acknowledged', source: 'NVD', cvss_score: 9.8, asset_id: 10,
  asset_name: 'edge-router-01', asset_vendor: 'Acme', asset_product: 'RouterOS',
  remediation: 'Patch to 7.1', created_at: '2026-11-10T08:00:00Z', acknowledged_at: null,
};

const get = vi.mocked(apiClient.get);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AlertDetail', () => {
  it('shows the EPSS score and percentile when available', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: 0.42, epss_percentile: 0.97 } };
      if (url === '/alerts/1/remediations') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} />);
    await waitFor(() => expect(screen.getByText('42.0%')).toBeTruthy());
    expect(screen.getByText(/higher than 97% of CVEs/)).toBeTruthy();
  });

  it('shows the fallback message when no EPSS data exists', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
      if (url === '/alerts/1/remediations') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} />);
    await waitFor(() => expect(screen.getByText('EPSS data not available')).toBeTruthy());
  });

  it('lists remediation actions ordered by priority with downtime details', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [
        { id: 2, alert_id: 1, action_type: 'network_segmentation', description: 'Isolate the router VLAN.',
          estimated_downtime_minutes: null, requires_maintenance_window: false, priority: 2,
          status: 'proposed', ai_confidence: 0.8, created_at: '2026-11-17T08:00:00Z' },
        { id: 1, alert_id: 1, action_type: 'patch', description: 'Apply the vendor patch.',
          estimated_downtime_minutes: 30, requires_maintenance_window: true, priority: 1,
          status: 'proposed', ai_confidence: 0.9, created_at: '2026-11-17T08:00:00Z' },
      ] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} />);
    await waitFor(() => expect(screen.getByText('Apply the vendor patch.')).toBeTruthy());
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('Apply the vendor patch.');
    expect(items[0].textContent).toContain('30 min downtime');
    expect(items[0].textContent).toContain('Needs a maintenance window');
    expect(items[1].textContent).toContain('Isolate the router VLAN.');
    expect(screen.getByText('Patch')).toBeTruthy();
    expect(screen.getByText('Network segmentation')).toBeTruthy();
  });

  it('renders without EPSS or remediation sections when both requests fail', async () => {
    get.mockRejectedValue(new Error('offline'));
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} />);
    expect(screen.getByText('RouterOS RCE')).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Exploit probability/)).toBeNull();
    expect(screen.queryByText('Remediation plan')).toBeNull();
  });
});
