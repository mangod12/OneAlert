import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { OTDiscovery } from './OTDiscovery';

const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

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
    if (url === '/ot/discovered-devices/1/promotion-review') return { data: { device_id: 1, can_promote: true, reviewed_fingerprint: 'a'.repeat(64), proposed_asset: { name: 'device-1', asset_type: 'hardware', criticality: 'low', last_known_ip: '10.0.0.1' }, existing_candidates: [], existing_candidate_total: 0 } };
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
    await waitFor(() => expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { page: 1, size: 20 } }));
    fireEvent.change(await screen.findByLabelText('Filter devices by IP'), { target: { value: '10.10' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { page: 1, size: 20, ip_address: '10.10' } });
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'OT devices only' }));
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { page: 1, size: 20, ot_only: true, ip_address: '10.10' } });
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

  it('edits a sensor name, location and segment without changing its type', async () => {
    patch.mockResolvedValue({ data: { ...sensors[0], name: 'plant-floor-1b', location: 'Plant B', network_segment: 'line-3' } });
    render(<OTDiscovery />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit sensor plant-floor-1' }));
    expect((screen.getByLabelText('Sensor name') as HTMLInputElement).value).toBe('plant-floor-1');
    expect((screen.getByLabelText('Sensor type') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Sensor name'), { target: { value: 'plant-floor-1b' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Plant B' } });
    fireEvent.change(screen.getByLabelText('Network segment'), { target: { value: 'line-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/ot/sensors/1', {
      name: 'plant-floor-1b', location: 'Plant B', network_segment: 'line-3',
    }));
    expect(await screen.findByText('plant-floor-1b')).toBeTruthy();
  });

  it('deletes a sensor through the confirm dialog', async () => {
    render(<OTDiscovery />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete sensor dmz-listener' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Delete sensor' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/ot/sensors/2'));
  });
});

const device = (id: number) => ({ id, ip_address: `10.0.0.${id}`, hostname: `device-${id}`, manufacturer: 'Test controls', risk_score: 60, is_correlated: false });
const pageResponse = (ids: number[], total = 21) => ({ data: { devices: ids.map(device), total, size: 20 } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function mockDevicePages(handler: (config: unknown) => unknown) {
  const fallback = get.getMockImplementation()!;
  get.mockImplementation((url, config) => url === '/ot/discovered-devices' ? Promise.resolve(handler(config)) : fallback(url, config));
}

describe('Discovered device paging and request identity', () => {
  it('reviews devices beyond the first twenty, keeps filters, and resets filters to page one', async () => {
    mockDevicePages(config => pageResponse((config as { params: { page: number } }).params.page === 2 ? [21] : [1]));
    render(<OTDiscovery />);
    await screen.findByText('device-1');
    fireEvent.click(screen.getByLabelText('OT devices only'));
    await screen.findByText('device-1');
    fireEvent.click(screen.getByRole('button', { name: 'Next devices' }));
    expect(await screen.findByText('device-21')).toBeTruthy();
    expect(screen.queryByText('device-1')).toBeNull();
    expect(screen.getByText(/Showing 21–21 of 21 matching devices/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next devices' }) as HTMLButtonElement).disabled).toBe(true);
    expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { page: 2, size: 20, ot_only: true } });
    fireEvent.change(screen.getByLabelText('Filter devices by IP'), { target: { value: '10.0' } });
    await screen.findByText('device-1');
    expect(get).toHaveBeenLastCalledWith('/ot/discovered-devices', { params: { page: 1, size: 20, ot_only: true, ip_address: '10.0' } });
  });

  it('clears obsolete rows while loading, ignores old initial results, and preserves a newer failure', async () => {
    const initial = deferred<ReturnType<typeof pageResponse>>();
    const filtered = deferred<ReturnType<typeof pageResponse>>();
    mockDevicePages(config => (config as { params: { ip_address?: string } }).params.ip_address ? filtered.promise : initial.promise);
    render(<OTDiscovery />);
    fireEvent.change(await screen.findByLabelText('Filter devices by IP'), { target: { value: '192' } });
    expect(screen.getByLabelText('Loading discovered devices')).toBeTruthy();
    filtered.reject(new Error('Filter failed'));
    await screen.findByText('Discovered devices unavailable');
    await act(async () => { initial.resolve(pageResponse([1])); });
    await waitFor(() => expect(screen.queryByText('device-1')).toBeNull());
    expect(screen.getByText('Discovered devices unavailable')).toBeTruthy();
    expect(screen.queryByText(/No devices discovered yet/)).toBeNull();
  });

  it('retries the failed device page without replacing the rest of the discovery dashboard', async () => {
    let fail = true;
    mockDevicePages(config => {
      if ((config as { params: { page: number } }).params.page === 2 && fail) throw new Error('Page unavailable');
      return pageResponse((config as { params: { page: number } }).params.page === 2 ? [21] : [1]);
    });
    render(<OTDiscovery />);
    await screen.findByText('device-1');
    fireEvent.click(screen.getByRole('button', { name: 'Next devices' }));
    await screen.findByText('Discovered devices unavailable');
    expect(screen.queryByText('device-1')).toBeNull();
    expect(screen.getByText('plant-floor-1')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('device-21')).toBeTruthy();
  });

  it('recovers a page that disappeared after the result set shrank', async () => {
    mockDevicePages(config => (config as { params: { page: number } }).params.page === 2 ? pageResponse([], 1) : pageResponse([1]));
    render(<OTDiscovery />);
    await screen.findByText('device-1');
    fireEvent.click(screen.getByRole('button', { name: 'Next devices' }));
    expect(await screen.findByText('device-1')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous devices' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not replace a new page when a promotion from the previous page completes', async () => {
    const promotion = deferred<{ data: object }>();
    post.mockReturnValue(promotion.promise);
    mockDevicePages(config => pageResponse((config as { params: { page: number } }).params.page === 2 ? [21] : [1]));
    render(<OTDiscovery />);
    await screen.findByText('device-1');
    fireEvent.click(screen.getByRole('button', { name: 'Promote to asset' }));
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create reviewed asset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next devices' }));
    await screen.findByText('device-21');
    await act(async () => { promotion.resolve({ data: { device_id: 1, asset_id: 10, asset_name: 'device-1', reviewed_fingerprint: 'a'.repeat(64) } }); });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(screen.getByText('device-21')).toBeTruthy();
    expect(screen.queryByText('device-1')).toBeNull();
    expect(screen.getByRole('cell', { name: 'Unmatched' })).toBeTruthy();
  });
});

it('opens the selected recorded device evidence without promoting or scanning', async () => {
  const fallback = get.getMockImplementation()!;
  get.mockImplementation((url, config) => {
    if (url === '/ot/discovered-devices') return Promise.resolve(pageResponse([21]));
    if (url === '/ot/discovered-devices/21') return Promise.resolve({ data: { ...device(21), notes: 'Confirm firmware before promotion', firmware_version: '5.2' } });
    return fallback(url, config);
  });
  render(<OTDiscovery />);
  const trigger = await screen.findByRole('button', { name: 'View recorded details for 10.0.0.21' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = within(await screen.findByRole('dialog'));
  expect(await dialog.findByText('Confirm firmware before promotion')).toBeTruthy();
  expect(dialog.getByText('5.2')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Close details' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View recorded details for 10.0.0.21' }));
});

it('combines triage filters, preserves them across pages and clears them together', async () => {
  mockDevicePages(config => pageResponse((config as { params: { page: number } }).params.page === 2 ? [21] : [1]));
  render(<OTDiscovery />);
  await screen.findByText('device-1');
  fireEvent.change(screen.getByLabelText('Search recorded devices'), { target: { value: 'MX-100' } });
  expect(screen.getByText('Search draft is not applied. Results and CSV still use the applied search.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search devices' }));
  fireEvent.change(screen.getByLabelText('Device correlation'), { target: { value: 'false' } });
  fireEvent.change(screen.getByLabelText('Device source sensor'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Device confidence'), { target: { value: 'high' } });
  fireEvent.change(screen.getByLabelText('Minimum device risk'), { target: { value: '70' } });
  fireEvent.change(screen.getByLabelText('Maximum device risk'), { target: { value: '90' } });
  fireEvent.change(screen.getByLabelText('Device order'), { target: { value: 'oldest' } });
  await screen.findByText('device-1');
  fireEvent.click(screen.getByRole('button', { name: 'Next devices' }));
  await screen.findByText('device-21');
  expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { page: 2, size: 20, search: 'MX-100', correlated: false, sensor_id: 1, confidence: 'high', risk_min: 70, risk_max: 90, sort: 'oldest' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear device filters' }));
  await screen.findByText('device-1');
  expect(get).toHaveBeenLastCalledWith('/ot/discovered-devices', { params: { page: 1, size: 20 } });
});

it('rejects reversed risk ranges locally rather than querying or exporting a broader inventory', async () => {
  mockDevicePages(() => pageResponse([1]));
  render(<OTDiscovery />);
  await screen.findByText('device-1');
  fireEvent.change(screen.getByLabelText('Minimum device risk'), { target: { value: '80' } });
  await screen.findByText('device-1');
  const count = get.mock.calls.length;
  fireEvent.change(screen.getByLabelText('Maximum device risk'), { target: { value: '20' } });
  expect(await screen.findByText('Use risk scores from 0 to 100, with minimum no greater than maximum.')).toBeTruthy();
  expect(get.mock.calls.length).toBe(count);
  expect((screen.getByRole('button', { name: 'Export matching devices CSV' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('device-1')).toBeNull();
});

it('exports matching filters without page limits and without using an unapplied search draft', async () => {
  mockDevicePages(() => pageResponse([1]));
  const fallback = get.getMockImplementation()!;
  get.mockImplementation((url, config) => url.endsWith('/export') ? Promise.resolve({ data: new Blob(['csv']) }) : fallback(url, config));
  const create = vi.fn(() => 'blob:device-export');
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<OTDiscovery />);
  await screen.findByText('device-1');
  fireEvent.change(screen.getByLabelText('Device source sensor'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Device correlation'), { target: { value: 'false' } });
  await screen.findByText('device-1');
  fireEvent.change(screen.getByLabelText('Search recorded devices'), { target: { value: 'not applied' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export matching devices CSV' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/ot/discovered-devices/export', { params: { sensor_id: 0, correlated: false }, responseType: 'blob' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
});

it('refreshes the active unmatched filter after promotion instead of leaving an obsolete row', async () => {
  let promoted = false;
  post.mockImplementation(async () => { promoted = true; return { data: { device_id: 1, asset_id: 10, asset_name: 'device-1', reviewed_fingerprint: 'a'.repeat(64) } }; });
  mockDevicePages(() => pageResponse(promoted ? [] : [1], promoted ? 0 : 1));
  render(<OTDiscovery />);
  await screen.findByText('device-1');
  fireEvent.change(screen.getByLabelText('Device correlation'), { target: { value: 'false' } });
  await screen.findByText('device-1');
  fireEvent.click(screen.getByRole('button', { name: 'Promote to asset' }));
  fireEvent.click(await within(screen.getByRole('dialog')).findByRole('checkbox'));
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create reviewed asset' }));
  expect(await screen.findByText('No devices match these filters.')).toBeTruthy();
  expect(screen.queryByText('device-1')).toBeNull();
  expect(get).toHaveBeenCalledWith('/ot/discovered-devices', { params: { page: 1, size: 20, correlated: false } });
});

it('offers reviewed existing-inventory linking without promoting a duplicate asset', async () => {
  const fallback = get.getMockImplementation()!;
  get.mockImplementation(async (url, config) => {
    if (url === '/ot/discovered-devices') return pageResponse([1], 1);
    if (url === '/assets/') return { data: { assets: [{ id: 10, name: 'Existing gateway' }], total: 1 } };
    if (url === '/ot/discovered-devices/1/correlation-review/10') return { data: {
      device: { ...device(1), asset_id: null }, asset: { id: 10, name: 'Existing gateway' },
      can_link: true, reviewed_fingerprint: 'a'.repeat(64),
    } };
    return fallback(url, config);
  });
  post.mockResolvedValue({ data: { id: 1, asset_id: 10, is_correlated: true, correlation_score: 100 } });
  render(<OTDiscovery />);
  fireEvent.click(await screen.findByRole('button', { name: 'Link 10.0.0.1 to existing asset' }));
  fireEvent.click(await screen.findByRole('button', { name: /Review asset #10/ }));
  fireEvent.click(await within(screen.getByRole('dialog')).findByRole('checkbox'));
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Link reviewed records' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(post).toHaveBeenCalledExactlyOnceWith('/ot/discovered-devices/1/correlate/10', undefined, { params: { reviewed_fingerprint: 'a'.repeat(64) } });
});
