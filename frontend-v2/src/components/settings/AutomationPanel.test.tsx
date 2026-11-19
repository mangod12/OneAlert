import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { AutomationPanel } from './AutomationPanel';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const patch = vi.mocked(apiClient.patch);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const DEFAULT_PREFS = {
  auto_escalate_incidents: true,
  auto_escalate_min_alerts: 4,
  auto_escalate_min_severity: 'critical',
  sla_due_dates_enabled: true,
  auto_assign_new_alerts: false,
  sla_days_critical: 1,
  sla_days_high: 3,
  sla_days_medium: 7,
  sla_days_low: 14,
  sla_days_info: 30,
};

const MEMBERS = [
  { id: 1, email: 'admin@example.com', full_name: 'Admin One', is_active: true },
  { id: 2, email: 'sam@example.com', full_name: 'Sam Two', is_active: true },
  { id: 3, email: 'gone@example.com', full_name: null, is_active: false },
];

const EMPTY_ROTATION = { member_ids: [], anchor_date: null, current_member_id: null };

function mockPrefs(prefs: unknown = DEFAULT_PREFS, rotation: unknown = EMPTY_ROTATION) {
  get.mockImplementation(async (url: string) => {
    if (url === '/auth/me/automation-preferences') return { data: prefs };
    if (url === '/orgs/me/on-call') return { data: rotation };
    if (url === '/orgs/me/members') return { data: MEMBERS };
    throw new Error(`unexpected ${url}`);
  });
}

describe('AutomationPanel', () => {
  it('loads and shows current preferences', async () => {
    mockPrefs();
    render(<AutomationPanel />);
    const toggle = await screen.findByLabelText('Auto-escalate noisy incidents to an investigation');
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Highest severity at least') as HTMLSelectElement).value).toBe('critical');
  });

  it('loads and shows SLA due-date preferences', async () => {
    mockPrefs();
    render(<AutomationPanel />);
    const slaToggle = await screen.findByLabelText('Set SLA due dates on new alerts and investigations');
    expect((slaToggle as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Critical (days)') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Info (days)') as HTMLInputElement).value).toBe('30');
  });

  it('saves updated preferences', async () => {
    mockPrefs({ ...DEFAULT_PREFS, auto_escalate_incidents: false, sla_due_dates_enabled: false });
    patch.mockResolvedValue({ data: {} });
    render(<AutomationPanel />);
    fireEvent.click(await screen.findByLabelText('Auto-escalate noisy incidents to an investigation'));
    fireEvent.change(screen.getByLabelText('Active alerts on one asset'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Highest severity at least'), { target: { value: 'critical' } });
    fireEvent.click(screen.getByLabelText('Set SLA due dates on new alerts and investigations'));
    fireEvent.change(screen.getByLabelText('High (days)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/auth/me/automation-preferences', {
      auto_escalate_incidents: true,
      auto_escalate_min_alerts: 5,
      auto_escalate_min_severity: 'critical',
      sla_due_dates_enabled: true,
      auto_assign_new_alerts: false,
      sla_days_critical: 1,
      sla_days_high: 5,
      sla_days_medium: 7,
      sla_days_low: 14,
      sla_days_info: 30,
    }));
  });

  it('saves the auto-assign toggle', async () => {
    mockPrefs();
    patch.mockResolvedValue({ data: {} });
    render(<AutomationPanel />);
    const toggle = await screen.findByLabelText('Auto-assign new alerts and investigations across your organization');
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/auth/me/automation-preferences',
      expect.objectContaining({ auto_assign_new_alerts: true })));
  });

  it('shows who is on call and saves rotation changes immediately', async () => {
    mockPrefs(DEFAULT_PREFS, { member_ids: [2, 1], anchor_date: '2026-11-16', current_member_id: 2 });
    patch.mockResolvedValue({ data: { member_ids: [1, 2], anchor_date: '2026-11-19', current_member_id: 1 } });
    render(<AutomationPanel />);
    await screen.findByText('On call this week: sam@example.com');
    expect(screen.queryByRole('button', { name: /gone@example.com/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Admin One/ }));
    // Admin One is already in the rotation; clicking removes them.
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/orgs/me/on-call', { member_ids: [2] }));
  });

  it('adds a member to an empty rotation', async () => {
    mockPrefs();
    patch.mockResolvedValue({ data: { member_ids: [2], anchor_date: '2026-11-19', current_member_id: 2 } });
    render(<AutomationPanel />);
    await screen.findByText('No rotation set: auto-assignment balances load across the whole organization.');
    fireEvent.click(screen.getByRole('button', { name: 'Sam Two' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/orgs/me/on-call', { member_ids: [2] }));
  });

  it('hides the rotation section for a solo organization', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/me/automation-preferences') return { data: DEFAULT_PREFS };
      if (url === '/orgs/me/on-call') return { data: EMPTY_ROTATION };
      if (url === '/orgs/me/members') return { data: [MEMBERS[0]] };
      throw new Error(`unexpected ${url}`);
    });
    render(<AutomationPanel />);
    await screen.findByLabelText('Auto-assign new alerts and investigations across your organization');
    expect(screen.queryByText('On-call rotation')).toBeNull();
  });

  it('rejects an out-of-range alert threshold', async () => {
    mockPrefs();
    render(<AutomationPanel />);
    fireEvent.change(await screen.findByLabelText('Active alerts on one asset'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range SLA target', async () => {
    mockPrefs();
    render(<AutomationPanel />);
    fireEvent.change(await screen.findByLabelText('Critical (days)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    expect(patch).not.toHaveBeenCalled();
  });

  it('disables the inputs while auto-escalation is off', async () => {
    mockPrefs({ ...DEFAULT_PREFS, auto_escalate_incidents: false });
    render(<AutomationPanel />);
    await screen.findByLabelText('Auto-escalate noisy incidents to an investigation');
    expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Highest severity at least') as HTMLSelectElement).disabled).toBe(true);
  });

  it('disables the SLA inputs while SLA due dates are off', async () => {
    mockPrefs({ ...DEFAULT_PREFS, sla_due_dates_enabled: false });
    render(<AutomationPanel />);
    await screen.findByLabelText('Set SLA due dates on new alerts and investigations');
    expect((screen.getByLabelText('Critical (days)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Info (days)') as HTMLInputElement).disabled).toBe(true);
  });
});
