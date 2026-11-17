import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient, { SESSION_EXPIRED_EVENT } from './client';

class FakeCustomEvent {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
}

function failingAdapter(status: number): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig) => {
    const error = new Error('Request failed') as Error & {
      config: InternalAxiosRequestConfig;
      response: { status: number };
      isAxiosError: boolean;
    };
    error.config = config;
    error.response = { status };
    error.isAxiosError = true;
    throw error;
  };
}

describe('apiClient response interceptor', () => {
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    dispatchEvent.mockClear();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', FakeCustomEvent);
  });

  it('exports a stable session-expired event name', () => {
    expect(SESSION_EXPIRED_EVENT).toBe('onealert:session-expired');
  });

  it('dispatches session-expired when a 401 comes from a non-auth endpoint', async () => {
    apiClient.defaults.adapter = failingAdapter(401);
    await expect(apiClient.get('/assets')).rejects.toThrow('Request failed');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(SESSION_EXPIRED_EVENT);
  });

  it('does not dispatch session-expired when a 401 comes from the login endpoint', async () => {
    apiClient.defaults.adapter = failingAdapter(401);
    await expect(apiClient.post('/auth/login', {})).rejects.toThrow('Request failed');
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('does not dispatch session-expired when a 401 comes from the register endpoint', async () => {
    apiClient.defaults.adapter = failingAdapter(401);
    await expect(apiClient.post('/auth/register', {})).rejects.toThrow('Request failed');
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('does not dispatch session-expired for non-401 errors', async () => {
    apiClient.defaults.adapter = failingAdapter(500);
    await expect(apiClient.get('/assets')).rejects.toThrow('Request failed');
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('passes successful responses through untouched', async () => {
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => ({
      data: { ok: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
    const response = await apiClient.get('/health');
    expect(response.data).toEqual({ ok: true });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
