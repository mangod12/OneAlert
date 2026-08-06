import axios from 'axios';

interface ErrorEnvelope {
  detail?: string | { message?: string };
  error?: { message?: string };
  message?: string;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError<ErrorEnvelope>(error)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  const data = error.response?.data;
  if (typeof data?.error?.message === 'string' && data.error.message.trim()) {
    return data.error.message;
  }
  if (typeof data?.detail === 'string' && data.detail.trim()) {
    return data.detail;
  }
  if (typeof data?.detail === 'object' && typeof data.detail?.message === 'string') {
    return data.detail.message;
  }
  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message;
  }
  if (!error.response) {
    return 'OneAlert could not reach the service. Check your connection and try again.';
  }
  return fallback;
}
