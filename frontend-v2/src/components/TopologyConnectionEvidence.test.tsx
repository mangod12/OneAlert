import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopologyConnectionEvidence, type RecordedTopologyEdge } from './TopologyConnectionEvidence';
const edge: RecordedTopologyEdge = { id: 7, source: '192.0.2.1', target: '192.0.2.2', protocol: 'modbus', is_encrypted: false, port: 0, bytes_transferred: '9223372036854775807', direction: 'outbound', first_seen: '2026-11-20T12:00:00Z', last_seen: '2026-11-20T13:00:00Z', source_device_id: 1 };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function show(value = edge) { const close = vi.fn(); render(<TopologyConnectionEvidence edge={value} receivedAt="2026-11-20T14:00:00Z" sourceLabel="Gateway" targetLabel="Controller" onClose={close} />); return close; }
describe('Recorded topology connection evidence', () => {
  it('shows exact bytes, zero port, missing linked ID and recorded-time caveats', () => {
    const close = show(); expect(screen.getByText('9223372036854775807')).toBeTruthy(); expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy(); expect(screen.getByText(/not a live reachability test/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close connection evidence' })); expect(close).toHaveBeenCalledOnce();
  });
  it('uses the additive exact counter when the legacy number exceeds browser precision', () => {
    show({ ...edge, bytes_transferred: Number.MAX_SAFE_INTEGER + 1, bytes_transferred_exact: '9223372036854775807' });
    expect(screen.getByText('9223372036854775807')).toBeTruthy();
  });
  it('does not invent precise bytes from an unsafe legacy number', () => {
    show({ ...edge, bytes_transferred: Number.MAX_SAFE_INTEGER + 1 });
    expect(screen.getByText('Numeric precision unavailable in this response')).toBeTruthy();
  });
  it('downloads bounded JSON without a new server request', async () => {
    let saved: Blob | undefined;
    vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { saved = blob; return 'blob:evidence'; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    show(); fireEvent.click(screen.getByRole('button', { name: 'Download connection evidence JSON' }));
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(saved!); });
    const body = JSON.parse(text); expect(body.connection.bytes_transferred).toBe('9223372036854775807');
    expect(body.connection.port).toBe(0); expect(body.connection.target_device_id).toBeNull();
    expect(body.graph_response_received_at).toBe('2026-11-20T14:00:00Z'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps the record visible on download failure', () => {
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('denied'); } });
    show(); fireEvent.click(screen.getByRole('button', { name: 'Download connection evidence JSON' }));
    expect(screen.getByRole('alert').textContent).toContain('could not be downloaded'); expect(screen.getByText('9223372036854775807')).toBeTruthy();
  });
});
