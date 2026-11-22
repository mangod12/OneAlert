import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';
import { useAuthStore } from '../stores/authStore';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  SESSION_EXPIRED_EVENT: 'onealert:session-expired',
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

const analyst = {
  id: 1,
  email: 'analyst@example.com',
  full_name: 'Analyst',
  company: 'Demo',
  is_active: true,
  mfa_enabled: false,
};

async function startSetup() {
  render(<Settings />);
  fireEvent.click(screen.getByRole('button', { name: /enable mfa/i }));
  await screen.findByText(/otpauth:\/\/totp\//, { exact: false });
}

const notFound = () => { const e = new Error('nf') as Error & { response?: { status: number } }; e.response = { status: 404 }; return Promise.reject(e); };

beforeEach(() => {
  vi.resetAllMocks();
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/integrations/types' || url === '/integrations/') return { data: { data: [] } };
    if (url === '/auth/me/notification-preferences') return { data: { email_notifications_enabled: true, notify_min_severity: 'low', muted_kinds: [], quiet_hours_start: null, quiet_hours_end: null, digest_enabled: false, digest_hour_utc: 7 } };
    if (url === '/auth/me/automation-preferences') return { data: { auto_escalate_incidents: false, auto_escalate_min_alerts: 3, auto_escalate_min_severity: 'high', sla_due_dates_enabled: false, auto_assign_new_alerts: false, sla_days_critical: 1, sla_days_high: 3, sla_days_medium: 7, sla_days_low: 14, sla_days_info: 30 } };
    return notFound();
  });
  mockPatch.mockImplementation(async (_url, data) => ({ data }));
  useAuthStore.setState({
    user: { ...analyst } as never,
    isAuthenticated: true,
    hasCheckedSession: true,
    isLoading: false,
    error: null,
  });
});
afterEach(cleanup);

describe('MFA setup verification', () => {
  it('shows a code input after setup and enables MFA on a matching code', async () => {
    mockPost.mockImplementation(url => Promise.resolve({
      data: url.endsWith('/mfa/setup') ? { provisioning_uri: 'otpauth://totp/OneAlert:analyst?secret=ABC' } : true,
    }));
    const fetchUser = vi.fn();
    useAuthStore.setState({ fetchUser } as never);
    await startSetup();
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/auth/me/mfa/verify', { code: '123456' }));
    expect(await screen.findByText('MFA is now enabled for this account.')).toBeTruthy();
    expect(fetchUser).toHaveBeenCalled();
  });

  it('shows an error and keeps the code field when the code does not match', async () => {
    mockPost.mockImplementation(url => Promise.resolve({
      data: url.endsWith('/mfa/setup') ? { provisioning_uri: 'otpauth://totp/OneAlert:analyst?secret=ABC' } : false,
    }));
    await startSetup();
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));
    expect(await screen.findByText(/did not match/)).toBeTruthy();
    expect(screen.getByLabelText('Authenticator code')).toBeTruthy();
  });
  it('disables MFA after confirming an authenticator code', async () => {
    mockPost.mockResolvedValue({ data: true });
    const fetchUser = vi.fn();
    useAuthStore.setState({ user: { ...analyst, mfa_enabled: true }, fetchUser } as never);
    render(<Settings />);
    await screen.findByText('MFA enabled');
    fireEvent.click(screen.getByRole('button', { name: /^Disable MFA$/ }));
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disable' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/auth/me/mfa/disable', { code: '123456' }));
    expect(await screen.findByText('MFA is now disabled for this account.')).toBeTruthy();
    expect(fetchUser).toHaveBeenCalled();
  });

  it('shows an error when the disable code is wrong', async () => {
    mockPost.mockResolvedValue({ data: false });
    useAuthStore.setState({ user: { ...analyst, mfa_enabled: true } } as never);
    render(<Settings />);
    await screen.findByText('MFA enabled');
    fireEvent.click(screen.getByRole('button', { name: /^Disable MFA$/ }));
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disable' }));
    expect(await screen.findByText('That code did not match. Check your authenticator and try again.')).toBeTruthy();
  });
});

describe('Reviewed organization entry', () => {
  it('keeps organization writes and identity reads behind the reviewed entry', () => {
    render(<Settings />);
    expect(screen.getByRole('button', { name: 'Open reviewed organization settings' })).toBeTruthy();
    expect(screen.queryByLabelText('Organization name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create organization' })).toBeNull();
    expect(mockGet.mock.calls.some(([url]) => url === '/orgs/me')).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('Email notification preferences', () => {
  it('loads current preferences into the form', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/auth/me/notification-preferences') return { data: { email_notifications_enabled: false, notify_min_severity: 'high', muted_kinds: [], quiet_hours_start: null, quiet_hours_end: null, digest_enabled: false, digest_hour_utc: 7 } };
      if (url === '/integrations/types' || url === '/integrations/') return { data: { data: [] } };
      return notFound();
    });
    render(<Settings />);
    const toggle = await screen.findByRole('checkbox', { name: /email me about new alerts/i });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/minimum severity/i) as HTMLSelectElement).value).toBe('high');
    expect((screen.getByLabelText(/minimum severity/i) as HTMLSelectElement).disabled).toBe(true);
  });

  it('saves updated preferences', async () => {
    render(<Settings />);
    const toggle = await screen.findByRole('checkbox', { name: /email me about new alerts/i });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText(/minimum severity/i), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review notification changes' }));
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification preferences' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/me/notification-preferences', {
      email_notifications_enabled: false,
      notify_min_severity: 'high',
      muted_kinds: [],
      quiet_hours_start: null,
      quiet_hours_end: null,
      digest_enabled: false,
      digest_hour_utc: 7,
    }));
    await screen.findByText(/The save response matches your reviewed notification preferences/);
  });

  it('saves muted in-app notification kinds', async () => {
    render(<Settings />);
    const caseAssignments = await screen.findByRole('checkbox', { name: /case assignments/i });
    fireEvent.click(caseAssignments);
    fireEvent.click(screen.getByRole('checkbox', { name: /alert assignments/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review notification changes' }));
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification preferences' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/me/notification-preferences', {
      email_notifications_enabled: true,
      notify_min_severity: 'low',
      muted_kinds: ['case_assigned', 'alert_assigned'],
      quiet_hours_start: null,
      quiet_hours_end: null,
      digest_enabled: false,
      digest_hour_utc: 7,
    }));
  });

  it('surfaces a save failure', async () => {
    mockPatch.mockRejectedValueOnce(new Error('boom'));
    render(<Settings />);
    const toggle = await screen.findByRole('checkbox', { name: /email me about new alerts/i });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Review notification changes' }));
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification preferences' }));
    await screen.findByText(/The save outcome could not be verified. It may already have applied. Read current notification preferences/);
  });

  it('loads and saves quiet hours', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/auth/me/notification-preferences') return { data: { email_notifications_enabled: true, notify_min_severity: 'low', muted_kinds: [], quiet_hours_start: '22:00', quiet_hours_end: '06:00', digest_enabled: false, digest_hour_utc: 7 } };
      if (url === '/integrations/types' || url === '/integrations/') return { data: { data: [] } };
      return notFound();
    });
    render(<Settings />);
    const from = await screen.findByLabelText('From') as HTMLInputElement;
    const until = screen.getByLabelText('Until') as HTMLInputElement;
    expect(from.value).toBe('22:00');
    expect(until.value).toBe('06:00');
    fireEvent.change(from, { target: { value: '23:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review notification changes' }));
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification preferences' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/me/notification-preferences', {
      email_notifications_enabled: true,
      notify_min_severity: 'low',
      muted_kinds: [],
      quiet_hours_start: '23:00',
      quiet_hours_end: '06:00',
      digest_enabled: false,
      digest_hour_utc: 7,
    }));
  });

  it('saves the daily digest preference', async () => {
    render(<Settings />);
    const digestToggle = await screen.findByRole('checkbox', { name: /send me a daily digest/i });
    fireEvent.click(digestToggle);
    fireEvent.change(screen.getByLabelText(/send at/i), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review notification changes' }));
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification preferences' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/me/notification-preferences', expect.objectContaining({
      digest_enabled: true,
      digest_hour_utc: 6,
    })));
  });

  it('requires both quiet hour times before saving', async () => {
    render(<Settings />);
    const from = await screen.findByLabelText('From');
    fireEvent.change(from, { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review notification changes' }));
    expect(await screen.findByText(/either two complete UTC quiet times or neither/)).toBeTruthy();
    expect(mockPatch).not.toHaveBeenCalledWith('/auth/me/notification-preferences', expect.anything());
  });

  it('clear sends a null pair', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/auth/me/notification-preferences') return { data: { email_notifications_enabled: true, notify_min_severity: 'low', muted_kinds: [], quiet_hours_start: '22:00', quiet_hours_end: '06:00', digest_enabled: false, digest_hour_utc: 7 } };
      if (url === '/integrations/types' || url === '/integrations/') return { data: { data: [] } };
      return notFound();
    });
    render(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review notification changes' }));
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed notification preferences' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/me/notification-preferences', {
      email_notifications_enabled: true,
      notify_min_severity: 'low',
      muted_kinds: [],
      quiet_hours_start: null,
      quiet_hours_end: null,
      digest_enabled: false,
      digest_hour_utc: 7,
    }));
  });

  it('changes the account password', async () => {
    mockPost.mockResolvedValue({ data: null });
    render(<Settings />);
    fireEvent.change(await screen.findByLabelText(/current password/i), { target: { value: 'old-password-1' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'new-password-2' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'new-password-2' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/auth/me/change-password', {
      current_password: 'old-password-1',
      new_password: 'new-password-2',
    }));
    await screen.findByText('Password updated.');
  });

  it('keeps profile writes behind an independently verified editor', () => {
    render(<Settings />);
    expect(screen.getByRole('button', { name: 'Open reviewed profile editor' })).toBeTruthy();
    expect(screen.queryByLabelText('Display name')).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('blocks mismatched new passwords before posting', async () => {
    render(<Settings />);
    fireEvent.change(await screen.findByLabelText(/current password/i), { target: { value: 'old-password-1' } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'new-password-2' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'different-3' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await screen.findByText('New passwords do not match.');
    expect(mockPost).not.toHaveBeenCalledWith('/auth/me/change-password', expect.anything());
  });
});
