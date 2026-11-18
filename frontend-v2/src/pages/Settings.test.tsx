import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    if (url === '/auth/me/notification-preferences') return { data: { email_notifications_enabled: true, notify_min_severity: 'low' } };
    return notFound();
  });
  mockPatch.mockResolvedValue({ data: { email_notifications_enabled: false, notify_min_severity: 'high' } });
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
});

describe('Team panel', () => {
  const org = { id: 7, name: 'Acme SOC', slug: 'acme-soc', plan: 'pro', max_assets: 100, max_users: 5, created_at: '2026-01-01T00:00:00Z' };
  const members = [
    { id: 1, email: 'analyst@example.com', full_name: 'Analyst One', is_active: true },
    { id: 2, email: 'idle@example.com', full_name: null, is_active: false },
  ];
  const admin = { ...analyst, role: 'admin' };

  function mockTeam() {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/orgs/me') return { data: org };
      if (url === '/orgs/me/members') return { data: members };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('lists organization members with seat usage and status', async () => {
    mockTeam();
    render(<Settings />);
    await screen.findByText('Analyst One');
    expect(screen.getByText(/Acme SOC · 2 of 5 seats used/)).toBeTruthy();
    expect(screen.getByText('idle@example.com')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('removes a member through the confirm dialog', async () => {
    useAuthStore.setState({ user: { ...admin } as never });
    mockTeam();
    mockDelete.mockResolvedValue({ data: { success: true } });
    render(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove idle@example.com from the organization' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/orgs/me/members/2'));
    await waitFor(() => expect(screen.queryByText('idle@example.com')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Remove analyst@example.com from the organization' })).toBeNull();
  });

  it('invites a member by email and refreshes the list', async () => {
    useAuthStore.setState({ user: { ...admin } as never });
    mockTeam();
    mockPost.mockResolvedValue({ data: { success: true } });
    render(<Settings />);
    await screen.findByText('Analyst One');
    fireEvent.change(screen.getByLabelText('Email to invite'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/orgs/me/invite', null, { params: { email: 'new@example.com' } }));
    expect(await screen.findByText(/new@example.com was added to Acme SOC/)).toBeTruthy();
  });

  it('hides the invite form for non-admins', async () => {
    mockTeam();
    render(<Settings />);
    await screen.findByText('Analyst One');
    expect(screen.queryByLabelText('Email to invite')).toBeNull();
  });

  it('shows the no-organization note when the account has no org', async () => {
    render(<Settings />);
    expect(await screen.findByText(/does not belong to an organization/)).toBeTruthy();
  });

  it('renames the organization as an admin and refreshes the panel', async () => {
    useAuthStore.setState({ user: { ...admin } as never });
    let currentName = org.name;
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/orgs/me') return { data: { ...org, name: currentName } };
      if (url === '/orgs/me/members') return { data: members };
      throw new Error(`unexpected ${url}`);
    });
    mockPatch.mockImplementation(async (url: string, body?: unknown) => {
      if (url === '/orgs/me') {
        currentName = (body as { name?: string } | undefined)?.name ?? currentName;
        return { data: { ...org, name: currentName } };
      }
      return { data: true };
    });
    render(<Settings />);
    await screen.findByText(/Acme SOC · 2 of 5 seats used/);
    fireEvent.click(screen.getByRole('button', { name: /rename organization/i }));
    fireEvent.change(screen.getByLabelText('New organization name'), { target: { value: 'Renamed SOC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/orgs/me', { name: 'Renamed SOC' }));
    expect(await screen.findByText('Organization renamed to Renamed SOC.')).toBeTruthy();
    expect(await screen.findByText(/Renamed SOC · 2 of 5 seats used/)).toBeTruthy();
  });

  it('hides the rename action for non-admins', async () => {
    mockTeam();
    render(<Settings />);
    await screen.findByText('Analyst One');
    expect(screen.queryByRole('button', { name: /rename organization/i })).toBeNull();
  });
});

describe('Organization creation', () => {
  it('creates an organization with a normalized slug and refreshes team and profile', async () => {
    const org = { id: 9, name: 'New SOC', slug: 'new-soc', plan: 'free', max_assets: 10, max_users: 2, created_at: '2026-11-17T00:00:00Z' };
    let created = false;
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/integrations/types' || url === '/integrations/') return { data: { data: [] } };
      if (created && url === '/orgs/me') return { data: org };
      if (created && url === '/orgs/me/members') return { data: [] };
      return notFound();
    });
    mockPost.mockImplementation(async (url: string) => {
      if (url === '/orgs/') { created = true; return { data: org }; }
      return { data: true };
    });
    const fetchUser = vi.fn();
    useAuthStore.setState({ fetchUser } as never);
    render(<Settings />);
    await screen.findByText(/does not belong to an organization/);
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'New SOC' } });
    fireEvent.change(screen.getByLabelText('Organization slug'), { target: { value: 'New-SOC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/orgs/', { name: 'New SOC', slug: 'new-soc' }));
    expect(await screen.findByText(/New SOC created/)).toBeTruthy();
    expect(fetchUser).toHaveBeenCalled();
    expect(await screen.findByText(/New SOC · 0 of 2 seats used/)).toBeTruthy();
  });

  it('rejects an invalid slug without posting', async () => {
    render(<Settings />);
    await screen.findByText(/does not belong to an organization/);
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'New SOC' } });
    fireEvent.change(screen.getByLabelText('Organization slug'), { target: { value: '-bad slug!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText(/lowercase letters, numbers and hyphens/)).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Email notification preferences', () => {
  it('loads current preferences into the form', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/auth/me/notification-preferences') return { data: { email_notifications_enabled: false, notify_min_severity: 'high' } };
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
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/me/notification-preferences', {
      email_notifications_enabled: false,
      notify_min_severity: 'high',
      muted_kinds: [],
    }));
    await screen.findByText('Notification preferences saved.');
  });

  it('saves muted in-app notification kinds', async () => {
    render(<Settings />);
    const caseAssignments = await screen.findByRole('checkbox', { name: /case assignments/i });
    fireEvent.click(caseAssignments);
    fireEvent.click(screen.getByRole('checkbox', { name: /alert assignments/i }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/me/notification-preferences', {
      email_notifications_enabled: true,
      notify_min_severity: 'low',
      muted_kinds: ['case_assigned', 'alert_assigned'],
    }));
  });

  it('surfaces a save failure', async () => {
    mockPatch.mockRejectedValueOnce(new Error('boom'));
    render(<Settings />);
    await screen.findByRole('checkbox', { name: /email me about new alerts/i });
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    await screen.findByRole('alert');
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
