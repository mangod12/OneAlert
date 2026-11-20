import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopologyEndpointIdentity, type EndpointIdentity } from './TopologyEndpointIdentity';
const record = { id: 7, hostname: 'west-controller', manufacturer: 'Vendor', model: null, sensor_id: 2, asset_id: null, is_ot_device: true, risk_score: 0, first_seen: null, last_seen: '2026-11-20T10:00:00Z' };
const node: EndpointIdentity = { id: '192.0.2.1', label: '192.0.2.1', identity_status: 'multiple_records', device_records: [record, { ...record, id: 9, hostname: 'east-controller', sensor_id: 3, risk_score: 84 }] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function show(value = node) { const close = vi.fn(); render(<TopologyEndpointIdentity node={value} onClose={close} />); return close; }
describe('Endpoint identity evidence', () => {
  it('keeps competing records and zero risk explicit without choosing an identity', () => {
    const close = show(); expect(screen.getByText('west-controller')).toBeTruthy(); expect(screen.getByText('east-controller')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy(); expect(screen.getByText('84')).toBeTruthy();
    expect(screen.getByText('2 matching device records. No single identity or risk score was chosen.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close endpoint identity' })); expect(close).toHaveBeenCalledOnce();
  });
  it('distinguishes absent legacy details from a current empty match set', () => {
    const { unmount } = render(<TopologyEndpointIdentity node={{ id: '192.0.2.8', label: 'Unknown' }} onClose={vi.fn()} />);
    expect(screen.getByText('Device identity details were not recorded in this response.')).toBeTruthy(); unmount();
    show({ ...node, device_records: [], identity_status: 'unmatched' }); expect(screen.getByText(/not proof that no device exists/)).toBeTruthy();
  });
  it('downloads both records without another server request', async () => {
    let blob: Blob | undefined;
    vi.stubGlobal('URL', { createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:identity'; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    show(); fireEvent.click(screen.getByRole('button', { name: 'Download endpoint identity JSON' }));
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); });
    const body = JSON.parse(text); expect(body.endpoint_ip).toBe('192.0.2.1'); expect(body.device_records.map((item: { id: number }) => item.id)).toEqual([7, 9]); expect(body.device_records[0].risk_score).toBe(0); expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps identity records visible when a download fails', () => {
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('denied'); } }); show(); fireEvent.click(screen.getByRole('button', { name: 'Download endpoint identity JSON' })); expect(screen.getByRole('alert').textContent).toContain('could not be downloaded'); expect(screen.getByText('west-controller')).toBeTruthy();
  });
});
