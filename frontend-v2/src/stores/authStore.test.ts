import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => {
  const post = vi.fn();
  const get = vi.fn();
  return {
    default: { post, get },
    SESSION_EXPIRED_EVENT: 'onealert:session-expired',
  };
});

import apiClient from '../api/client';
import type { User } from '../api/types';
import { useAuthStore } from './authStore';

const mockUser: User = {
  id: 1,
  email: 'analyst@example.com',
  full_name: 'Analyst',
  company: null,
  role: 'analyst',
  is_active: true,
  is_verified: true,
  mfa_enabled: false,
  created_at: '2026-01-01T00:00:00Z',
};

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    hasCheckedSession: false,
    isLoading: false,
    error: null,
  });
});

describe('authStore.login', () => {
  it('sets the user on success', async () => {
    post.mockResolvedValueOnce({});
    get.mockResolvedValueOnce({ data: mockUser });

    await useAuthStore.getState().login('analyst@example.com', 'secret');

    const state = useAuthStore.getState();
    expect(post).toHaveBeenCalledWith(
      '/auth/login',
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('clears the session and records the error on failure', async () => {
    post.mockRejectedValueOnce(new Error('bad credentials'));

    await expect(
      useAuthStore.getState().login('analyst@example.com', 'wrong'),
    ).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toBe('bad credentials');
  });
});

describe('authStore.logout', () => {
  it('clears local state even when the API call fails', async () => {
    useAuthStore.setState({ user: mockUser, isAuthenticated: true });
    post.mockRejectedValueOnce(new Error('network down'));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toBeNull();
  });
});

describe('authStore.fetchUser', () => {
  it('marks the session checked and unauthenticated on 401', async () => {
    get.mockRejectedValueOnce(new Error('unauthorized'));

    await useAuthStore.getState().fetchUser();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.hasCheckedSession).toBe(true);
  });
});
