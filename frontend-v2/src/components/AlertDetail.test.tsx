import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';
import type { Alert } from '../api/types';
import { AlertDetail } from './AlertDetail';

vi.mock('../api/client', () => ({
  SESSION_EXPIRED_EVENT: 'onealert:session-expired',
  default: {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
  },
}));

const alert: Alert = {
  id: 1, user_id: 5, cve_id: 'CVE-2026-0001', title: 'RouterOS RCE', description: 'Remote code execution.',
  severity: 'critical', status: 'acknowledged', source: 'NVD', cvss_score: 9.8, asset_id: 10,
  asset_name: 'edge-router-01', asset_vendor: 'Acme', asset_product: 'RouterOS',
  remediation: 'Patch to 7.1', created_at: '2026-11-10T08:00:00Z', acknowledged_at: null, assigned_to_id: null, assigned_to_email: null,
};

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

describe('AlertDetail', () => {
  it('shows the EPSS score and percentile when available', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: 0.42, epss_percentile: 0.97 } };
      if (url === '/alerts/1/remediations') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(screen.getByText('42.0%')).toBeTruthy());
    expect(screen.getByText(/higher than 97% of CVEs/)).toBeTruthy();
  });

  it('shows the fallback message when no EPSS data exists', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
      if (url === '/alerts/1/remediations') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(screen.getByText('EPSS data not available')).toBeTruthy());
  });

  it('lists remediation actions ordered by priority with downtime details', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
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
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
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
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    expect(screen.getByText('RouterOS RCE')).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(8));
    expect(screen.queryByText(/Exploit probability/)).toBeNull();
    expect(screen.queryByText('Remediation plan')).toBeNull();
  });
});

describe('Escalate to investigation', () => {
  function mockDetailGets() {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('creates a case, links the alert, and navigates to the case', async () => {
    mockDetailGets();
    post.mockResolvedValue({ data: { id: 42, alert_id: 1, linked: true, reviewed_fingerprint: 'b'.repeat(64) } });
    render(<MemoryRouter><AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /open investigation/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Open investigation' });
    expect(await within(dialog).findByLabelText('Title')).toHaveProperty('value', 'Investigate: Saved alert');
    await within(dialog).findByRole('checkbox'); fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create reviewed investigation' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledExactlyOnceWith('/alerts/1/investigations', { title: 'Investigate: Saved alert', summary: null, severity: 'critical', reviewed_fingerprint: 'b'.repeat(64) });
    });
  });

  it('shows an inline error and stays open when creation fails', async () => {
    mockDetailGets();
    post.mockRejectedValue({ isAxiosError: true, response: { status: 500, data: {} } });
    render(<MemoryRouter><AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /open investigation/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Open investigation' });
    await within(dialog).findByRole('checkbox'); fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create reviewed investigation' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Open investigation' })).toBeTruthy();
  });

  it('assigns the alert to an org member and reports the change', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [
        { id: 1, email: 'analyst@example.com', full_name: 'Analyst One', is_active: true },
        { id: 2, email: 'soc-lead@example.com', full_name: 'Sam Oclead', is_active: true },
        { id: 3, email: 'idle@example.com', full_name: null, is_active: false },
      ] };
      throw new Error(`unexpected ${url}`);
    });
    const patch = vi.mocked(apiClient.patch);
    patch.mockResolvedValue({ data: {} });
    const onAssigned = vi.fn();
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={onAssigned} />);
    const select = await screen.findByLabelText('Assigned to');
    // inactive member is not offered
    expect(within(select as HTMLElement).queryByText(/idle@example.com/)).toBeNull();
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/alerts/1', { assigned_to_id: 2 }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(1, 2, 'soc-lead@example.com'));
  });

  it('shows an inline error when assignment fails', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [
        { id: 2, email: 'soc-lead@example.com', full_name: 'Sam Oclead', is_active: true },
      ] };
      throw new Error(`unexpected ${url}`);
    });
    const patch = vi.mocked(apiClient.patch);
    patch.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { detail: 'Assignee must be an active member of your organization' } } });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    const select = await screen.findByLabelText('Assigned to');
    fireEvent.change(select, { target: { value: '2' } });
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });
});

describe('Resolve action', () => {
  it('shows Resolve Alert for non-resolved alerts and calls onResolve', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
      if (url === '/alerts/1/remediations') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    const onResolve = vi.fn();
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={onResolve} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    const button = await screen.findByRole('button', { name: /resolve alert/i });
    fireEvent.click(button);
    expect(onResolve).toHaveBeenCalledWith(1);
  });

  it('hides Resolve Alert when the alert is already resolved', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
      if (url === '/alerts/1/remediations') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={{ ...alert, status: 'resolved' }} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(screen.getByText('RouterOS RCE')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /resolve alert/i })).toBeNull();
  });
});

describe('KEV panel', () => {
  it('shows KEV details when the CVE is catalogued', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/alerts/kev-batch') return { data: { entries: { 'CVE-2026-0001': { date_added: '2026-05-01', due_date: '2026-05-22', known_ransomware_campaign_use: 'Known', required_action: 'Apply updates per vendor.' } } } };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    await screen.findByText('CISA Known Exploited Vulnerability');
    expect(screen.getByText(/active exploitation reported/)).toBeTruthy();
    expect(screen.getByText(/remediation due 2026-05-22/)).toBeTruthy();
    expect(screen.getByText('Used in ransomware campaigns')).toBeTruthy();
    expect(screen.getByText('Apply updates per vendor.')).toBeTruthy();
  });

  it('shows no KEV panel when the CVE is not catalogued', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/alerts/kev-batch') return { data: { entries: {} } };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/alerts/kev-batch', { params: { cve_ids: 'CVE-2026-0001' } }));
    expect(screen.queryByText('CISA Known Exploited Vulnerability')).toBeNull();
  });
});

describe('Reopen action', () => {
  function mockResolvedGets() {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/alerts/kev-batch') return { data: { entries: {} } };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('shows Reopen Alert for resolved alerts and calls onReopen', async () => {
    mockResolvedGets();
    const onReopen = vi.fn();
    render(<AlertDetail alert={{ ...alert, status: 'resolved' }} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={onReopen} onSnooze={() => {}} onAssigned={() => {}} />);
    const button = await screen.findByRole('button', { name: /reopen alert/i });
    expect(screen.queryByRole('button', { name: /resolve alert/i })).toBeNull();
    fireEvent.click(button);
    expect(onReopen).toHaveBeenCalledWith(1);
  });

  it('hides Reopen Alert for non-resolved alerts', async () => {
    mockResolvedGets();
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(screen.getByText('RouterOS RCE')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /reopen alert/i })).toBeNull();
  });
});

describe('AlertDetail snooze', () => {
  it('offers 24h, 7d and 30d snooze options for a non-resolved alert', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    const onSnooze = vi.fn();
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={onSnooze} onAssigned={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snooze alert for 24h' }));
    expect(onSnooze).toHaveBeenCalledWith(1, 24);
    fireEvent.click(screen.getByRole('button', { name: 'Snooze alert for 7d' }));
    expect(onSnooze).toHaveBeenCalledWith(1, 168);
    fireEvent.click(screen.getByRole('button', { name: 'Snooze alert for 30d' }));
    expect(onSnooze).toHaveBeenCalledWith(1, 720);
  });

  it('shows the snooze state and clear action when snoozed', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    const snoozed: Alert = { ...alert, snoozed_until: new Date(Date.now() + 86_400_000).toISOString() };
    const onSnooze = vi.fn();
    render(<AlertDetail alert={snoozed} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={onSnooze} onAssigned={() => {}} />);
    expect(screen.getByText(/Snoozed until/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Snooze alert for 24h' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear snooze' }));
    expect(onSnooze).toHaveBeenCalledWith(1, null);
  });

  it('hides snooze options for a resolved alert', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={{ ...alert, status: 'resolved' }} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Snooze alert for 24h' })).toBeNull();
  });
});

describe('AlertDetail investigations', () => {
  const baseMocks = (cases: unknown) => async (url: string) => {
    if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null, message: 'EPSS data not available' } };
    if (url === '/alerts/1/remediations') return { data: [] };
    if (url === '/alerts/1/cases') return { data: cases };
    if (url === '/alerts/1/notes') return { data: [] };
    if (url === '/orgs/me/members') return { data: [] };
    throw new Error(`unexpected ${url}`);
  };

  it('lists linked cases with status badges and navigates on click', async () => {
    get.mockImplementation(baseMocks([
      { id: 21, title: 'Line 3 investigation', status: 'open', severity: 'high', created_at: '2026-11-18T08:00:00Z' },
      { id: 22, title: 'Follow-up review', status: 'resolved', severity: 'medium', created_at: '2026-11-17T08:00:00Z' },
    ]));
    render(<MemoryRouter><AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} /></MemoryRouter>);
    expect(await screen.findByText('Investigations')).toBeTruthy();
    expect(screen.getByText('Line 3 investigation')).toBeTruthy();
    expect(screen.getByText('Follow-up review')).toBeTruthy();
    expect(screen.getByText('open')).toBeTruthy();
    expect(screen.getByText('resolved')).toBeTruthy();
  });

  it('hides the investigations section when the alert is in no case', async () => {
    get.mockImplementation(baseMocks([]));
    render(<MemoryRouter><AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} /></MemoryRouter>);
    await screen.findByText('Notes');
    expect(screen.queryByText('Investigations')).toBeNull();
  });

  it('hides the investigations section when the fetch fails', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/cases') throw new Error('upstream down');
      return baseMocks([])(url);
    });
    render(<MemoryRouter><AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} /></MemoryRouter>);
    await screen.findByText('Notes');
    expect(screen.queryByText('Investigations')).toBeNull();
  });
});

describe('AlertDetail notes', () => {
  function mockNotesGets(notes: unknown[] = []) {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [] };
      if (url === '/alerts/1/notes') return { data: notes };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('lists existing notes', async () => {
    mockNotesGets([{ id: 5, alert_id: 1, user_id: 5, user_email: 'owner@example.com', body: 'Vendor confirms patch due Friday', created_at: '2026-11-17T09:00:00Z', edited_at: null }]);
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    expect(await screen.findByText('Vendor confirms patch due Friday')).toBeTruthy();
    expect(screen.getByText(/owner@example\.com/)).toBeTruthy();
  });

  it('highlights the deep-linked note', async () => {
    mockNotesGets([
      { id: 5, alert_id: 1, user_id: 5, user_email: 'owner@example.com', body: 'First note', created_at: '2026-11-17T09:00:00Z', edited_at: null },
      { id: 9, alert_id: 1, user_id: 5, user_email: 'owner@example.com', body: 'Second note', created_at: '2026-11-17T10:00:00Z', edited_at: null },
    ]);
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} highlightNoteId={9} />);
    expect(await screen.findByText('Second note')).toBeTruthy();
    expect(document.getElementById('alert-note-9')?.className).toContain('ring-1');
    expect(document.getElementById('alert-note-5')?.className).not.toContain('ring-1');
  });

  it('adds a note and shows it', async () => {
    mockNotesGets();
    post.mockResolvedValue({ data: { id: 6, alert_id: 1, body: 'Escalated to OT lead', created_at: '2026-11-18T05:00:00Z' } } as never);
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    expect(await screen.findByText('No notes yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'Escalated to OT lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/alerts/1/notes', { body: 'Escalated to OT lead' }));
    expect(await screen.findByText('Escalated to OT lead')).toBeTruthy();
  });

  it('lets the author edit a note and shows the edited marker', async () => {
    useAuthStore.setState({ user: { id: 5, email: 'owner@example.com', full_name: 'Owner', company: 'Acme', role: 'admin', is_active: true, is_verified: true, mfa_enabled: false, created_at: '2026-01-01T00:00:00Z' } });
    mockNotesGets([{ id: 8, alert_id: 1, user_id: 5, body: 'first draft', created_at: '2026-11-17T09:00:00Z', edited_at: null }]);
    const patch = vi.mocked(apiClient.patch);
    patch.mockResolvedValue({ data: { id: 8, alert_id: 1, user_id: 5, body: 'second draft', created_at: '2026-11-17T09:00:00Z', edited_at: '2026-11-18T06:00:00Z' } } as never);
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Edit note 8'));
    const editBox = screen.getByLabelText('Edit note');
    expect((editBox as HTMLTextAreaElement).value).toBe('first draft');
    fireEvent.change(editBox, { target: { value: 'second draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/alerts/1/notes/8', { body: 'second draft' }));
    expect(await screen.findByText('second draft')).toBeTruthy();
    expect(screen.getByText(/edited/)).toBeTruthy();
  });

  it('hides the edit button on notes written by someone else', async () => {
    useAuthStore.setState({ user: { id: 42, email: 'member@example.com', full_name: 'Member', company: 'Acme', role: 'analyst', is_active: true, is_verified: true, mfa_enabled: false, created_at: '2026-01-01T00:00:00Z' } });
    mockNotesGets([{ id: 9, alert_id: 1, user_id: 5, body: 'owner note', created_at: '2026-11-17T09:00:00Z', edited_at: null }]);
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    expect(await screen.findByText('owner note')).toBeTruthy();
    expect(screen.queryByLabelText('Edit note 9')).toBeNull();
  });

  it('deletes a note', async () => {
    mockNotesGets([{ id: 7, alert_id: 1, body: 'obsolete note', created_at: '2026-11-17T09:00:00Z' }]);
    const del = vi.mocked(apiClient.delete);
    del.mockResolvedValue({} as never);
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Delete note 7'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/alerts/1/notes/7'));
    expect(screen.queryByText('obsolete note')).toBeNull();
  });
});

describe('AlertDetail activity', () => {
  it('lists audit activity for the alert', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [] };
      if (url === '/alerts/1/notes') return { data: [] };
      if (url === '/alerts/1/activity') return { data: [
        { id: 3, action: 'alert_updated', detail: 'status: pending -> acknowledged', timestamp: '2026-11-18T10:00:00Z' },
      ] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    expect(await screen.findByText('alert_updated')).toBeTruthy();
    expect(screen.getByText('status: pending -> acknowledged')).toBeTruthy();
  });

  it('hides the activity section when there is no activity', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { cve_id: 'CVE-2026-0001', epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      if (url === '/orgs/me/members') return { data: [] };
      if (url === '/alerts/1/notes') return { data: [] };
      if (url === '/alerts/1/activity') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Activity')).toBeNull());
  });
});

describe('Assignee gating', () => {
  const memberUser = {
    id: 42, email: 'member@example.com', full_name: 'Member', company: 'Acme',
    role: 'analyst', is_active: true, is_verified: true, mfa_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  const renderDetail = () => render(
    <AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />
  );
  const mockDrawerGets = () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/orgs/me/members') return { data: [{ id: 42, email: 'member@example.com', full_name: 'Member', is_active: true }] };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null } };
      return { data: [] };
    });
  };

  it('hides the assign control from non-owners', async () => {
    useAuthStore.setState({ user: memberUser });
    mockDrawerGets();
    renderDetail();
    await waitFor(() => expect(screen.getByText('RouterOS RCE')).toBeTruthy());
    expect(screen.queryByLabelText('Assigned to')).toBeNull();
  });

  it('shows the assign control to the owner', async () => {
    useAuthStore.setState({ user: { ...memberUser, id: 5, email: 'owner@example.com' } });
    mockDrawerGets();
    renderDetail();
    expect(await screen.findByLabelText('Assigned to')).toBeTruthy();
  });
});

describe('Alert watchers', () => {
  const ownerUser = {
    id: 5, email: 'owner@example.com', full_name: 'Owner', company: 'Acme',
    role: 'admin', is_active: true, is_verified: true, mfa_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  const memberUser = {
    id: 42, email: 'member@example.com', full_name: 'Member', company: 'Acme',
    role: 'analyst', is_active: true, is_verified: true, mfa_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  const renderDetail = () => render(
    <AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />
  );
  const mockGets = (watchers: unknown[] = []) => {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: watchers };
      if (url === '/orgs/me/members') return { data: [{ id: 42, email: 'member@example.com', full_name: 'Member', is_active: true }] };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null } };
      return { data: [] };
    });
  };

  it('toggles watching on and off for the current user', async () => {
    useAuthStore.setState({ user: memberUser });
    let watching: unknown[] = [];
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: watching };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null } };
      return { data: [] };
    });
    post.mockImplementation(async () => {
      watching = [{ user_id: 42, email: 'member@example.com', full_name: 'Member' }];
      return { data: {} };
    });
    renderDetail();
    const toggle = await screen.findByLabelText('Watch this alert');
    fireEvent.click(toggle);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/alerts/1/watch'));
    await waitFor(() => expect(screen.getByLabelText('Stop watching this alert')).toBeTruthy());
  });

  it('lets the owner add a watcher from the member list', async () => {
    useAuthStore.setState({ user: ownerUser });
    mockGets([]);
    post.mockResolvedValue({ data: [{ user_id: 42, email: 'member@example.com', full_name: 'Member' }] });
    renderDetail();
    const select = await screen.findByLabelText('Add an alert watcher');
    fireEvent.change(select, { target: { value: '42' } });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/alerts/1/watchers', { user_id: 42 }));
    await screen.findByText('Member');
  });

  it('hides the add-watcher select from non-owners but keeps the watch toggle', async () => {
    useAuthStore.setState({ user: memberUser });
    mockGets([]);
    renderDetail();
    await screen.findByLabelText('Watch this alert');
    await waitFor(() => expect(screen.queryByLabelText('Add an alert watcher')).toBeNull());
  });
});

describe('AlertDetail triage due date', () => {
  function mockDetailEndpoints() {
    get.mockImplementation(async (url: string) => {
      if (url === '/alerts/1/watchers') return { data: [] };
      if (url === '/alerts/1/investigation-preview') return { data: { alert: { id: 1, title: 'Saved alert', severity: 'critical', status: 'pending', asset_id: 1, cve_id: 'CVE-2026-0001' }, alert_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), existing_case_count: 0, existing_cases: [], due_dates: {info:null,low:null,medium:null,high:null,critical:null} } };
      if (url === '/alerts/1/epss') return { data: { epss_score: null, epss_percentile: null } };
      if (url === '/alerts/1/remediations') return { data: [] };
      return { data: [] };
    });
  }

  it('saves a triage due date from the drawer', async () => {
    mockDetailEndpoints();
    const patch = vi.mocked(apiClient.patch);
    patch.mockResolvedValue({ data: {} });
    const onDueDateChange = vi.fn();
    render(<AlertDetail alert={alert} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} onDueDateChange={onDueDateChange} />);
    const input = await screen.findByLabelText('Triage due date');
    fireEvent.change(input, { target: { value: '2026-11-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/alerts/1', { due_date: '2026-11-25' }));
    expect(onDueDateChange).toHaveBeenCalledWith(1, '2026-11-25');
  });

  it('clears a saved due date', async () => {
    mockDetailEndpoints();
    const patch = vi.mocked(apiClient.patch);
    patch.mockResolvedValue({ data: {} });
    const onDueDateChange = vi.fn();
    render(<AlertDetail alert={{ ...alert, due_date: '2026-11-25' }} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} onDueDateChange={onDueDateChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/alerts/1', { due_date: null }));
    expect(onDueDateChange).toHaveBeenCalledWith(1, null);
  });

  it('flags an overdue alert in the drawer', async () => {
    mockDetailEndpoints();
    render(<AlertDetail alert={{ ...alert, due_date: '2020-01-01' }} onClose={() => {}} onAcknowledge={() => {}} onResolve={() => {}} onReopen={() => {}} onSnooze={() => {}} onAssigned={() => {}} />);
    expect(await screen.findByText(/Overdue: the triage target has passed/)).toBeTruthy();
  });
});
