import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { OTDiscovery } from './OTDiscovery';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const patch = vi.mocked(apiClient.patch);
const del = vi.mocked(apiClient.delete);

const sensors = [
  { id: 1, name: 'plant-floor-1', sensor_type: 'passive', location: 'Plant A', network_segment: 'plant', enabled: true, last_heartbeat: '2026-11-17T09:00:00Z', last_discovery_count: 12 },
  { id: 2, name: 'dmz-listener', sensor_type: 'agent', location: null, network_segment: null, enabled: false, last_heartbeat: null, last_discovery_count: 0 },
];

beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/ot/summary') return { data: { managed_ot_assets: 1, discovered_ot_devices: 2, high_risk_devices: 0, uncorrelated_devices: 1 } };
    if (url === '/ot/discovered-devices') return { data: { devices: [], total: 0, page: 1, size: 20 } };
    if (url === '/ot/devices-by-protocol') return { data: { protocols: [] } };
    if (url === '/ot/sensors') return { data: sensors };
    throw new Error(`unexpected ${url}`);
  });
  post.mockResolvedValue({ data: {} });
  patch.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Discovered device filters', () => {
  it('sends the IP substring and OT-only flag to the API', async () => {
    render(<OTDiscovery />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { size: 20 } }));
    fireEvent.change(await screen.findByLabelText('Filter devices by IP'), { target: { value: '10.10' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { size: 20, ip_address: '10.10' } });
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'OT devices only' }));
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { size: 20, ot_only: true, ip_address: '10.10' } });
    });
  });
});

describe('OT sensors', () => {
  it('lists sensors with status, location and heartbeat', async () => {
    render(<OTDiscovery />);
    await screen.findByText('plant-floor-1');
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByText(/Plant A · plant/)).toBeTruthy();
    expect(screen.getByText(/no heartbeat yet/)).toBeTruthy();
  });

  it('registers a new sensor', async () => {
    render(<OTDiscovery />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register sensor' }));
    fireEvent.change(screen.getByLabelText('Sensor name'), { target: { value: 'rack-2' } });
    fireEvent.change(screen.getByLabelText('Network segment'), { target: { value: 'dmz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/ot/sensors', {
      name: 'rack-2', sensor_type: 'passive', location: null, network_segment: 'dmz',
    }));
  });

  it('disables an enabled sensor', async () => {
    render(<OTDiscovery />);
    await screen.findByText('plant-floor-1');
    const disableButtons = screen.getAllByRole('button', { name: 'Disable' });
    fireEvent.click(disableButtons[0]);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/ot/sensors/1', { enabled: false }));
  });

  it('deletes a sensor through the confirm dialog', async () => {
    render(<OTDiscovery />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete sensor dmz-listener' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Delete sensor' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/ot/sensors/2'));
  });
});
