import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { DiscoveredDeviceInspector } from './DiscoveredDeviceInspector';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const device = {
  id: 21, hostname: 'Line two controller', ip_address: '192.0.2.21', mac_address: '02:00:00:00:00:21',
  device_class: 'PLC', manufacturer: 'Test controls', model: 'CTRL-2', firmware_version: '4.2', serial_number: 'RECORD-21',
  is_ot_device: true, ot_device_type: 'plc', confidence: 'medium', discovery_method: 'sensor_report', sensor_id: 3,
  asset_id: null, is_correlated: false, correlation_score: 0, risk_score: 0, risk_factors: ['exposed_service'],
  ports_open: [502, 443], services_detected: ['Modbus', 'HTTPS'], protocols: ['modbus'], industrial_protocols: ['Modbus/TCP'],
  tags: ['line-2'], first_seen: '2026-11-20T00:00:00Z', last_seen: '2026-11-20T04:00:00Z',
  description: 'Recorded controller', notes: 'Review before inventory promotion',
};
const close = vi.fn();
const view = (id = 21) => <DiscoveredDeviceInspector deviceId={id} onClose={close} />;
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: device }); });
afterEach(cleanup);

describe('Recorded discovery evidence inspector', () => {
  it('loads owner-scoped recorded fingerprints, protocols, risk and source without editing or scanning', async () => {
    render(view());
    await screen.findByText('Line two controller');
    expect(get).toHaveBeenCalledWith('/ot/discovered-devices/21');
    for (const text of ['192.0.2.21', '02:00:00:00:00:21', 'CTRL-2', '4.2', 'RECORD-21', 'medium', 'sensor_report', '502, 443', 'Modbus, HTTPS', 'modbus', 'Modbus/TCP', 'line-2', 'Unmatched', 'exposed_service', 'Review before inventory promotion']) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText(/not a live scan or connectivity check/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /promote|scan/i })).toBeNull();
  });
  it('labels missing evidence instead of inventing fingerprint values', async () => {
    get.mockResolvedValue({ data: { id: 21, ip_address: '192.0.2.21', last_seen: 'invalid-time' } });
    render(view());
    await screen.findByText('invalid-time');
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(15);
  });
  it('downloads only the loaded record and disables export during manual enrichment', async () => {
    const create = vi.fn().mockReturnValue('blob:device'); const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(view()); await screen.findByText('Line two controller');
    fireEvent.click(screen.getByRole('button', { name: 'Download device evidence JSON' }));
    expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Review manual enrichment' }));
    expect((screen.getByRole('button', { name: 'Download device evidence JSON' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Save or cancel manual enrichment before downloading the record.')).toBeTruthy();
    click.mockRestore(); vi.unstubAllGlobals();
  });
  it('retries a failed read', async () => {
    get.mockRejectedValueOnce(new Error('Temporarily unavailable'));
    render(view());
    await screen.findByRole('alert');
    expect(screen.queryByText('Line two controller')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry device details' }));
    await screen.findByText('Line two controller');
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('rejects mismatched response identity', async () => {
    get.mockResolvedValue({ data: { ...device, id: 99 } });
    render(view());
    await screen.findByText('The response did not match this device. Try again.');
    expect(screen.queryByText('Line two controller')).toBeNull();
  });
  it('does not let an old device response replace the current selection', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementation(url => url === '/ot/discovered-devices/21' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ data: { ...device, id: 22, hostname: 'Current device' } }));
    const { rerender } = render(view());
    rerender(view(22));
    await screen.findByText('Current device');
    await act(async () => { resolveOld({ data: device }); });
    expect(screen.queryByText('Line two controller')).toBeNull();
    expect(screen.getByText('Current device')).toBeTruthy();
  });
  it('focuses the dialog close button and supports Escape', async () => {
    render(view());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close details' })));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

it('opens explicit enrichment review and cancels without changing the displayed evidence', async () => {
  render(view());
  fireEvent.click(await screen.findByRole('button', { name: 'Review manual enrichment' }));
  expect(screen.getByRole('form', { name: 'Manual device enrichment' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Enrichment Firmware version'), { target: { value: '5.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel enrichment' }));
  expect(screen.queryByRole('form', { name: 'Manual device enrichment' })).toBeNull();
  expect(screen.getByText('4.2')).toBeTruthy();
  expect(screen.queryByText('5.2')).toBeNull();
});
