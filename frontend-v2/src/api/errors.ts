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


/** Blob downloads also return errors as Blobs; inspect only bounded JSON envelopes. */
export async function getDownloadErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (!axios.isAxiosError(error) || !(error.response?.data instanceof Blob)) return getApiErrorMessage(error, fallback);
  const blob = error.response.data;
  if (blob.size > 65536 || !blob.type.toLowerCase().includes('json')) return fallback;
  try {
    const data = JSON.parse(await blob.text());
    return getApiErrorMessage({ ...error, isAxiosError: true, response: { ...error.response, data } }, fallback);
  } catch { return fallback; }
}
