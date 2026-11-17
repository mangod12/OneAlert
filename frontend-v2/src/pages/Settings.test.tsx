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
    return notFound();
  });
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
});
