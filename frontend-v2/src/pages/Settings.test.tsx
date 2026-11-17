import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';
import { useAuthStore } from '../stores/authStore';

vi.mock('../api/client', () => ({
  default: {
    post: vi.fn(),
    patch: vi.fn(),
  },
  SESSION_EXPIRED_EVENT: 'onealert:session-expired',
}));

import apiClient from '../api/client';

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

beforeEach(() => {
  vi.resetAllMocks();
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
