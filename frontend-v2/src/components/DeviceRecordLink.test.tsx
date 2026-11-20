import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceRecordLink } from './DeviceRecordLink';
import { TopologyEndpointIdentity } from './TopologyEndpointIdentity';
import { TopologyConnectionEvidence } from './TopologyConnectionEvidence';
import { DeviceConnectionEvidence } from './DeviceConnectionEvidence';
import apiClient from '../api/client';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('Exact inventory record navigation', () => {
  it.each([null, undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('does not link absent or unsafe ID %s', value => {
    render(<DeviceRecordLink deviceId={value} />); expect(screen.queryByRole('link')).toBeNull();
  });
  it('uses the app route and exact numeric ID without treating a link as an access grant', () => {
    render(<DeviceRecordLink deviceId={41} />); expect(screen.getByRole('link', { name: 'Open inventory record #41' }).getAttribute('href')).toBe('/app/ot?device=41');
  });
  it('keeps distinct links for every ambiguous IP-matched inventory record', () => {
    const record = { hostname: null, manufacturer: null, model: null, sensor_id: null, asset_id: null, is_ot_device: true, risk_score: null, first_seen: null, last_seen: null };
    render(<TopologyEndpointIdentity node={{ id: '192.0.2.1', label: '192.0.2.1', identity_status: 'multiple_records', device_records: [{ ...record, id: 41 }, { ...record, id: 42 }] }} onClose={vi.fn()} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open inventory record #41' }).getAttribute('href')).toBe('/app/ot?device=41');
    expect(screen.getByRole('link', { name: 'Open inventory record #42' }).getAttribute('href')).toBe('/app/ot?device=42');
    expect(screen.getByText(/No single identity or risk score was chosen/)).toBeTruthy();
  });
  it('only links explicit source and target references from a connection, never its addresses', () => {
    render(<TopologyConnectionEvidence edge={{ id: 12, source: '192.0.2.1', target: '192.0.2.2', protocol: 'modbus', port: 0, is_encrypted: false, source_device_id: 41, target_device_id: null }} receivedAt={null} sourceLabel="Address A" targetLabel="Address B" onClose={vi.fn()} />);
    expect(screen.getAllByRole('link')).toHaveLength(1); expect(screen.getByRole('link').getAttribute('href')).toBe('/app/ot?device=41');
    expect(screen.getByText(/not IP matches, and do not grant access/)).toBeTruthy();
  });
  it('opens referenced peer records from device connection details using their IDs', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { device_id: 7, ip_address: '192.0.2.7', match: 'all', encryption: 'all', page: 1, size: 20, total: 1, retrieved_at: 'now', connections: [{ id: 12, source: '192.0.2.7', target: '192.0.2.42', protocol: 'modbus', port: 0, is_encrypted: false, source_device_id: 7, target_device_id: 42, record_reference_match: true, ip_address_match: true }] } });
    render(<DeviceConnectionEvidence deviceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Review connection matches' }));
    fireEvent.click(await screen.findByText('Recorded connection fields'));
    expect((await screen.findByRole('link', { name: 'Open inventory record #42' })).getAttribute('href')).toBe('/app/ot?device=42');
  });
});
