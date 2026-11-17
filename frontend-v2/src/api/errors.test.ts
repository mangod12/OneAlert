import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';

import { getApiErrorMessage } from './errors';

function axiosErrorWith(data: unknown, withResponse = true): AxiosError {
  const err = new AxiosError('Request failed');
  if (withResponse) {
    err.response = {
      data,
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: {} } as InternalAxiosRequestConfig,
    };
  }
  return err;
}

describe('getApiErrorMessage', () => {
  it('prefers the error.message envelope', () => {
    const err = axiosErrorWith({ error: { message: 'MFA code required' }, detail: 'ignored' });
    expect(getApiErrorMessage(err, 'fallback')).toBe('MFA code required');
  });

  it('uses a string detail', () => {
    const err = axiosErrorWith({ detail: 'Invalid credentials' });
    expect(getApiErrorMessage(err, 'fallback')).toBe('Invalid credentials');
  });

  it('uses a nested detail.message', () => {
    const err = axiosErrorWith({ detail: { message: 'Account locked' } });
    expect(getApiErrorMessage(err, 'fallback')).toBe('Account locked');
  });

  it('uses a top-level message', () => {
    const err = axiosErrorWith({ message: 'Rate limit exceeded' });
    expect(getApiErrorMessage(err, 'fallback')).toBe('Rate limit exceeded');
  });

  it('falls back when envelope fields are blank', () => {
    const err = axiosErrorWith({ detail: '   ', message: '' });
    expect(getApiErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('returns a connection message when there is no response', () => {
    const err = axiosErrorWith(undefined, false);
    expect(getApiErrorMessage(err, 'fallback')).toMatch(/could not reach the service/i);
  });

  it('uses the Error message for non-axios errors', () => {
    expect(getApiErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('uses the fallback for non-Error values', () => {
    expect(getApiErrorMessage('nope', 'fallback')).toBe('fallback');
    expect(getApiErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
