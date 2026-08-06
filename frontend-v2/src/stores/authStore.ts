import { create } from 'zustand';
import apiClient, { SESSION_EXPIRED_EVENT } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  hasCheckedSession: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, company?: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  clearError: () => void;
}

const anonymousState = {
  user: null,
  isAuthenticated: false,
  hasCheckedSession: true,
  isLoading: false,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...anonymousState,
  hasCheckedSession: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const formData = new URLSearchParams({ username: email, password });
      await apiClient.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const userResponse = await apiClient.get<User>('/auth/me');
      set({ user: userResponse.data, isAuthenticated: true, hasCheckedSession: true, isLoading: false });
    } catch (error: unknown) {
      set({ ...anonymousState, error: getApiErrorMessage(error, 'Sign-in failed. Check your credentials and try again.') });
      throw error;
    }
  },

  register: async (email, password, fullName, company) => {
    set({ isLoading: true, error: null });
    try {
      await apiClient.post('/auth/register', { email, password, full_name: fullName, company: company || null });
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ error: getApiErrorMessage(error, 'Registration failed. Review your details and try again.'), isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    set({ ...anonymousState, error: null });
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Keep local session cleared if the service is unavailable.
    }
  },

  fetchUser: async () => {
    try {
      const response = await apiClient.get<User>('/auth/me');
      set({ user: response.data, isAuthenticated: true, hasCheckedSession: true, error: null });
    } catch {
      set({ ...anonymousState });
    }
  },

  clearError: () => set({ error: null }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_EXPIRED_EVENT, () => useAuthStore.setState({ ...anonymousState }));
}
