import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { OTDiscovery } from './OTDiscovery';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
function RouteProbe() { const location = useLocation(), navigate = useNavigate(); return <><output aria-label="Current route">{location.pathname + location.search}</output><button onClick={() => navigate('/ot?device=8&keep=yes')}>Open another device</button><button onClick={() => navigate(-1)}>Go back</button></>; }
function show(path: string) { render(<MemoryRouter initialEntries={[path]}><RouteProbe /><OTDiscovery /></MemoryRouter>); }
beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/ot/summary') return { data: { managed_ot_assets: 0, discovered_ot_devices: 0, high_risk_devices: 0, uncorrelated_devices: 0 } };
    if (url === '/ot/discovered-devices') return { data: { devices: [], total: 0 } };
    if (url === '/ot/devices-by-protocol') return { data: { protocols: [] } };
    if (url === '/ot/sensors') return { data: [] };
    if (/\/ot\/discovered-devices\/[78]$/.test(url)) return { data: { id: Number(url.slice(-1)), ip_address: '192.0.2.1', hostname: `Device ${url.slice(-1)}` } };
    throw new Error('unavailable');
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
describe('Device record deep links', () => {
  it('loads an ID outside the current list and preserves unrelated parameters when closed', async () => {
    show('/ot?device=7&keep=yes'); expect(await screen.findByText('Device 7')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/ot/discovered-devices/7');
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByLabelText('Current route').textContent).toBe('/ot?keep=yes');
  });
  it.each(['0', '-1', '7.5', '9007199254740993', 'bad', '7&device=8'])('rejects malformed or ambiguous ID %s without fetching a record', async value => {
    show(`/ot?device=${value}`); await screen.findByText(/must contain exactly one positive record ID/);
    expect(get.mock.calls.some(([url]) => /\/discovered-devices\//.test(String(url)))).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear invalid device link' })); expect(screen.getByLabelText('Current route').textContent).toBe('/ot');
  });
  it('follows navigation and Back without stale details', async () => {
    show('/ot?device=7'); await screen.findByText('Device 7'); fireEvent.click(screen.getByRole('button', { name: 'Open another device' }));
    await screen.findByText('Device 8'); expect(screen.queryByText('Device 7')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' })); expect(await screen.findByText('Device 7')).toBeTruthy();
  });
  it('copies a record-only link without filters or hash and warns about access', async () => {
    window.history.replaceState(null, '', '/app/ot?device=7&keep=private#section');
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    show('/ot?device=7&keep=private'); await screen.findByText('Device 7'); fireEvent.click(screen.getByRole('button', { name: 'Copy device record link' }));
    await screen.findByText('Device record link copied.'); const url = new URL(copy.mock.calls[0][0]); expect(url.pathname).toBe('/app/ot'); expect(url.search).toBe('?device=7'); expect(url.hash).toBe('');
    expect(screen.getByText(/It does not grant access/)).toBeTruthy();
  });
  it('keeps an inaccessible record visible as an error, not another device or a promotion', async () => {
    show('/ot?device=999'); expect(await screen.findByRole('button', { name: 'Retry device details' })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
  });
});
