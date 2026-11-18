import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './Login';
import { useAuthStore } from '../stores/authStore';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  SESSION_EXPIRED_EVENT: 'onealert:session-expired',
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

const analyst = {
  id: 1, email: 'analyst@example.com', full_name: 'Analyst', company: 'Demo',
  is_active: true, role: 'admin', is_verified: true, created_at: '2026-01-01T00:00:00Z',
};

function axiosError(status: number, detail: string) {
  return { isAxiosError: true, response: { status, data: { detail } }, message: detail };
}

describe('Login MFA challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null, isAuthenticated: false, hasCheckedSession: false,
      isLoading: false, error: null,
    } as never);
  });
  afterEach(() => {
    cleanup();
  });

  it('asks for the authenticator code when the backend requires it and retries with the scope field', async () => {
    mockPost
      .mockRejectedValueOnce(axiosError(401, 'MFA code required'))
      .mockResolvedValueOnce({ data: { access_token: 'token' } });
    mockGet.mockResolvedValue({ data: analyst });

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'analyst@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    const codeField = await screen.findByLabelText('Authenticator code');
    expect(screen.getByRole('button', { name: 'Verify and sign in' })).toBeTruthy();

    fireEvent.change(codeField, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    const secondBody = mockPost.mock.calls[1][1] as URLSearchParams;
    expect(secondBody.get('scope')).toBe('123456');
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
  });

  it('shows the invalid-code error without hiding the code field', async () => {
    mockPost
      .mockRejectedValueOnce(axiosError(401, 'MFA code required'))
      .mockRejectedValueOnce(axiosError(401, 'Invalid MFA code'));

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'analyst@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    const codeField = await screen.findByLabelText('Authenticator code');
    fireEvent.change(codeField, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(await screen.findByText('Invalid MFA code')).toBeTruthy();
    expect(screen.getByLabelText('Authenticator code')).toBeTruthy();
  });

  it('shows a generic error for wrong credentials without asking for a code', async () => {
    mockPost.mockRejectedValueOnce(axiosError(401, 'Incorrect email or password'));

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Incorrect email or password')).toBeTruthy();
    expect(screen.queryByLabelText('Authenticator code')).toBeNull();
  });
});
