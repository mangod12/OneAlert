import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { DeviceConnectionEvidence } from './DeviceConnectionEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { id: 12, source: '192.0.2.1', target: '192.0.2.2', protocol: 'modbus', port: 0, direction: 'outbound', bytes_transferred_exact: '9223372036854775807', first_seen: '2026-11-20T12:00:00+05:30', last_seen: '2026-11-20T13:00:00Z', is_encrypted: false, source_device_id: null, target_device_id: null, record_reference_match: false, ip_address_match: true };
const snapshot = { device_id: 7, ip_address: '192.0.2.1', page: 1, size: 20, total: 1, match: 'all', encryption: 'all', retrieved_at: '2026-11-20T14:00:00Z', connections: [row] };
const open = async () => { render(<DeviceConnectionEvidence deviceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Review connection matches' })); await screen.findByText(/#12:/); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Recorded device connection matches', () => {
  it('reads only after review and displays match basis, exact counters and port zero', async () => {
    render(<DeviceConnectionEvidence deviceId={7} />); expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review connection matches' })); await screen.findByText(/#12:/);
    expect(get).toHaveBeenCalledWith('/ot/discovered-devices/7/connections', { params: { page: 1, size: 20, match: 'all', encryption: 'all' } });
    expect(screen.getByText(/modbus, port 0/)).toBeTruthy(); expect(screen.getByText('No device record reference · Current IP match')).toBeTruthy();
    expect(screen.getByText('9223372036854775807')).toBeTruthy(); expect(screen.getByText(row.first_seen)).toBeTruthy();
    expect(screen.getByText(/Shared or changed IPs do not prove physical identity/)).toBeTruthy();
  });
  it('filters server-side and clears stale records while loading', async () => {
    await open(); let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(screen.getByLabelText('Connection match basis'), { target: { value: 'record' } });
    expect(screen.queryByText(/#12:/)).toBeNull(); expect(screen.queryByRole('button', { name: 'Download loaded connection page JSON' })).toBeNull();
    await act(async () => finish({ data: { ...snapshot, match: 'record', total: 0, connections: [] } }));
    expect(screen.getByText(/does not establish that the device has no network activity/)).toBeTruthy();
    expect(get.mock.calls.at(-1)?.[1]).toEqual({ params: { page: 1, size: 20, match: 'record', encryption: 'all' } });
  });
  it('ignores late results after filters change', async () => {
    let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<DeviceConnectionEvidence deviceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Review connection matches' }));
    get.mockResolvedValueOnce({ data: { ...snapshot, encryption: 'encrypted', connections: [{ ...row, id: 13, is_encrypted: true }] } });
    fireEvent.change(screen.getByLabelText('Connection encryption filter'), { target: { value: 'encrypted' } }); await screen.findByText(/#13:/);
    await act(async () => finish({ data: snapshot })); expect(screen.queryByText(/#12:/)).toBeNull();
  });
  it('reports unavailable evidence and retries instead of an empty success', async () => {
    get.mockRejectedValueOnce(new Error('Unavailable')); render(<DeviceConnectionEvidence deviceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Review connection matches' }));
    await screen.findByRole('alert'); expect(screen.queryByText(/No recorded connections match/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection matches' })); await screen.findByText(/#12:/);
  });
  it('refuses a mismatched device or filter response', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, device_id: 99 } }); render(<DeviceConnectionEvidence deviceId={7} />); fireEvent.click(screen.getByRole('button', { name: 'Review connection matches' }));
    await screen.findByText(/did not match the requested device/); expect(screen.queryByText(/#12:/)).toBeNull();
  });
  it('paginates and resets to page one when filters change', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, total: 21 } }); await open();
    get.mockResolvedValueOnce({ data: { ...snapshot, page: 2, total: 21, connections: [{ ...row, id: 21 }] } }); fireEvent.click(screen.getByRole('button', { name: 'Next connections' })); await screen.findByText(/#21:/);
    get.mockResolvedValueOnce({ data: { ...snapshot, encryption: 'cleartext' } }); fireEvent.change(screen.getByLabelText('Connection encryption filter'), { target: { value: 'cleartext' } }); await screen.findByText(/#12:/);
    expect(get.mock.calls.at(-1)?.[1]).toEqual({ params: { page: 1, size: 20, match: 'all', encryption: 'cleartext' } });
  });
  it('does not turn a missing encryption flag into a cleartext claim', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, connections: [{ ...row, is_encrypted: null, bytes_transferred_exact: null }] } }); await open();
    expect(screen.getByText(/modbus, port 0 · Encryption flag not recorded/)).toBeTruthy();
    expect(screen.queryByText(/modbus, port 0 · Recorded cleartext/)).toBeNull();
  });
  it('downloads only the loaded page with filter, timestamp and match metadata', async () => {
    const create = vi.fn().mockReturnValue('blob:page'); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); await open(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded connection page JSON' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce()); expect(click).toHaveBeenCalledOnce(); expect(create.mock.calls[0][0].type).toBe('application/json');
  });
});
it('shows the full matching overlapping-reference summary independently of loaded rows and filters unknown encryption',async()=>{
  get.mockResolvedValueOnce({data:{...snapshot,total:201,summary:{total:201,record_references:100,ip_matches:121,both_matches:20,encrypted:50,cleartext:100,unknown_encryption:51}}});await open();
  const summary=screen.getByRole('region',{name:'Full matching connection summary'});expect(summary.textContent).toContain('Matching records201');expect(summary.textContent).toContain('Both reference and IP20');
  get.mockResolvedValueOnce({data:{...snapshot,encryption:'unknown',connections:[{...row,is_encrypted:null}],summary:{total:1,record_references:0,ip_matches:1,both_matches:0,encrypted:0,cleartext:0,unknown_encryption:1}}});fireEvent.change(screen.getByLabelText('Connection encryption filter'),{target:{value:'unknown'}});await screen.findByText(/modbus, port 0 · Encryption flag not recorded/);expect(get).toHaveBeenLastCalledWith('/ot/discovered-devices/7/connections',{params:{page:1,size:20,match:'all',encryption:'unknown'}});
});
it.each([{total:1,record_references:1,ip_matches:1,both_matches:0,encrypted:0,cleartext:1,unknown_encryption:0},{total:1,record_references:0,ip_matches:1,both_matches:0,encrypted:0,cleartext:1,unknown_encryption:1}])('does not invent totals for an inconsistent summary %j',async summary=>{
  get.mockResolvedValueOnce({data:{...snapshot,summary}});await open();expect(screen.getByText(/Full matching connection summary unavailable/)).toBeTruthy();expect(screen.getByText(/#12:/)).toBeTruthy();
});
