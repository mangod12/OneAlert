import { describe, expect, it } from 'vitest';
import { getDownloadErrorMessage } from './errors';
function failure(data: unknown) { return { isAxiosError: true, response: { status: 422, data } }; }
describe('Download error envelopes', () => {
  it('reads safe JSON messages from blob responses without changing successful downloads', async () => {
    const envelope = new Blob([JSON.stringify({ error: { message: 'Too many records. No partial CSV was created.' } })], { type: 'application/json' });
    // jsdom Blob omits text; the browser implementation is exercised by a real download flow.
    Object.defineProperty(envelope, 'text', { value: async () => JSON.stringify({ error: { message: 'Too many records. No partial CSV was created.' } }) });
    expect(await getDownloadErrorMessage(failure(envelope), 'Fallback')).toBe('Too many records. No partial CSV was created.');
  });
  it('does not read oversized, non-JSON or malformed payloads', async () => {
    expect(await getDownloadErrorMessage(failure(new Blob(['x'.repeat(65537)], { type: 'application/json' })), 'Fallback')).toBe('Fallback');
    expect(await getDownloadErrorMessage(failure(new Blob(['HTML error'], { type: 'text/html' })), 'Fallback')).toBe('Fallback');
    expect(await getDownloadErrorMessage(failure(new Blob(['{'], { type: 'application/json' })), 'Fallback')).toBe('Fallback');
  });
  it('keeps standard envelopes and network errors supported', async () => {
    expect(await getDownloadErrorMessage(failure({ detail: 'Narrow the filters.' }), 'Fallback')).toBe('Narrow the filters.');
    expect(await getDownloadErrorMessage({ isAxiosError: true }, 'Fallback')).toContain('could not reach');
  });
});
