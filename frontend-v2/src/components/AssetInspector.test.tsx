import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssetInspector } from './AssetInspector';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const asset = { id: 7, name: 'Plant gateway', asset_type: 'plc', vendor: 'Acme', product: 'Controller', version: '3.1', is_ot_asset: true, criticality: 'high', network_zone: 'control', primary_protocol: 'modbus', secondary_protocols: '["opc_ua"]', last_known_ip: '192.0.2.10', serial_number: 'RECORDED-123', firmware_version: '4.2', model_number: 'CTRL-2', discovery_method: 'manual', cpe_string: 'cpe:2.3:h:example:gateway', description: 'Line one\nLine two', created_at: '2026-11-20T00:00:00Z', risk_score: 12, risk_level: 'medium' };
const close = vi.fn();
const view = (id = 7) => <MemoryRouter><AssetInspector assetId={id} onClose={close} /></MemoryRouter>;
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: asset }); });
afterEach(cleanup);

describe('Asset context inspector', () => {
  it('loads the current owner-scoped detail and displays recorded OT context without editing', async () => {
    render(view());
    expect(await screen.findByText('Plant gateway')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/assets/7');
    for (const value of ['192.0.2.10', 'RECORDED-123', '4.2', 'CTRL-2', 'modbus', '["opc_ua"]', 'control', 'manual', 'cpe:2.3:h:example:gateway']) expect(screen.getByText(value)).toBeTruthy();
    expect(screen.getByText('Computed risk: medium (12)')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    const link = screen.getByRole('link', { name: 'Review alerts for this asset' });
    expect(link.getAttribute('href')).toBe('/alerts?asset_id=7');
    fireEvent.click(link); expect(close).toHaveBeenCalledOnce();
  });
  it('shows missing records explicitly rather than inventing values', async () => {
    get.mockResolvedValue({ data: { id: 7, name: 'Minimal asset', created_at: 'invalid-date' } });
    render(view());
    await screen.findByText('Minimal asset');
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(5);
    expect(screen.getByText('Computed risk: Not available')).toBeTruthy();
    expect(screen.getByText('invalid-date')).toBeTruthy();
  });
  it('retries a failure without showing stale detail', async () => {
    get.mockRejectedValueOnce(new Error('Detail unavailable'));
    render(view());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Plant gateway')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry asset details' }));
    expect(await screen.findByText('Plant gateway')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('rejects a mismatched asset response', async () => {
    get.mockResolvedValue({ data: { ...asset, id: 99 } });
    render(view());
    expect(await screen.findByText('The response did not match this asset. Try again.')).toBeTruthy();
    expect(screen.queryByText('Plant gateway')).toBeNull();
  });
  it('ignores an obsolete result after the asset changes', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementation(url => url === '/assets/7' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ data: { ...asset, id: 8, name: 'Current asset' } }));
    const { rerender } = render(view());
    rerender(view(8));
    await screen.findByText('Current asset');
    await act(async () => { resolveOld({ data: asset }); });
    expect(screen.queryByText('Plant gateway')).toBeNull();
    expect(screen.getByText('Current asset')).toBeTruthy();
  });
  it('focuses close and handles Escape', async () => {
    render(view());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close details' })));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
