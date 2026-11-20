import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Incidents } from './Incidents';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const incident = {
  asset_id: 5, asset_name: 'plc-01', asset_vendor: 'Acme', asset_product: 'PLC-300',
  asset_criticality: 'critical', max_severity: 'critical', alert_count: 3,
  shared_cves: ['CVE-2026-1001', 'CVE-2026-1002'],
  first_seen: '2026-11-17T08:00:00Z', last_seen: '2026-11-18T09:00:00Z',
  blast_radius: 2,
  linked_cases: [{ id: 9, title: 'PLC compromise', status: 'open' }],
  alerts: [
    { id: 11, cve_id: 'CVE-2026-1001', title: 'Modbus coil write', severity: 'critical', status: 'pending', created_at: '2026-11-17T08:00:00Z' },
    { id: 12, cve_id: 'CVE-2026-1002', title: 'Firmware backdoor', severity: 'high', status: 'acknowledged', created_at: '2026-11-18T09:00:00Z' },
  ],
};

function mockGets(timeline: unknown[] = []) {
  get.mockImplementation(async (url: string) => {
    if (url === '/incidents') return { data: { total: 1, incidents: [incident] } };
    if (url === '/incidents/5/timeline') return { data: { asset_id: 5, asset_name: 'plc-01', events: timeline } };
    throw new Error(`unexpected ${url}`);
  });
}

function renderPage() {
  return render(<MemoryRouter><Incidents /></MemoryRouter>);
}

describe('Incidents', () => {
  it('lists correlated incidents with severity and blast radius', async () => {
    mockGets();
    renderPage();
    expect(await screen.findByText('plc-01')).toBeTruthy();
    expect(screen.getByText('critical')).toBeTruthy();
    expect(screen.getByText(/3 active alerts/)).toBeTruthy();
    expect(screen.getByText(/blast radius 2 connections/)).toBeTruthy();
    expect(screen.getByText(/CVE-2026-1001/)).toBeTruthy();
  });

  it('expands to show alerts, linked cases and the timeline', async () => {
    mockGets([
      { kind: 'alert_updated', alert_id: 11, title: 'Modbus coil write', detail: 'status: pending -> acknowledged', timestamp: '2026-11-18T10:00:00Z' },
      { kind: 'alert_created', alert_id: 11, title: 'Modbus coil write', detail: 'critical severity', timestamp: '2026-11-17T08:00:00Z' },
    ]);
    renderPage();
    fireEvent.click(await screen.findByText('plc-01'));
    expect(await screen.findByText('Modbus coil write')).toBeTruthy();
    expect(screen.getByText('PLC compromise')).toBeTruthy();
    expect(await screen.findByText('Alert updated')).toBeTruthy();
    expect(screen.getByText(/status: pending -> acknowledged/)).toBeTruthy();
    expect((screen.getByText('View these alerts in the alert list') as HTMLAnchorElement).href).toContain('/alerts?asset_id=5');
  });

  it('passes the severity filter to the API when changed', async () => {
    mockGets();
    renderPage();
    await screen.findByText('plc-01');
    fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'high' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/incidents', { params: { severity: 'high' } }));
  });

  it('passes the asset filter to the API on submit', async () => {
    mockGets();
    renderPage();
    await screen.findByText('plc-01');
    fireEvent.change(screen.getByLabelText('Filter incidents by asset'), { target: { value: 'plc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/incidents', { params: { asset: 'plc' } }));
  });

  it('shows the empty state when nothing correlates', async () => {
    get.mockResolvedValue({ data: { total: 0, incidents: [] } });
    renderPage();
    expect(await screen.findByText('No incidents')).toBeTruthy();
  });

  it('shows the error state when loading fails', async () => {
    get.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Incidents unavailable')).toBeTruthy();
  });

  it('escalates an incident to a new investigation and navigates to it', async () => {
    mockGets();
    post.mockResolvedValue({ data: { id: 44, title: 'Incident on plc-01', severity: 'critical', alerts_linked: 3 } });
    render(
      <MemoryRouter initialEntries={['/incidents']}>
        <Routes>
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/cases/44" element={<p>Case 44 opened</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('plc-01'));
    fireEvent.click(await screen.findByText('Escalate to investigation'));
    expect(await screen.findByText('Case 44 opened')).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/incidents/5/escalate');
  });
});


describe('Incident CSV export', () => {
  it('downloads the loaded incident rows without another request', async () => {
    mockGets();
    const create = vi.fn(() => 'blob:incidents-test');
    const revoke = vi.fn();
    const OriginalURL = URL;
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    const button = screen.getByRole('button', { name: 'Export filtered CSV' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await screen.findByText('plc-01');
    fireEvent.click(button);
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:incidents-test');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('blocks export while filters load and ignores an older response', async () => {
    mockGets();
    renderPage();
    await screen.findByText('plc-01');
    let resolveOld!: (value: { data: { incidents: typeof incident[] } }) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'high' } });
    expect((screen.getByRole('button', { name: 'Export filtered CSV' }) as HTMLButtonElement).disabled).toBe(true);
    get.mockResolvedValueOnce({ data: { incidents: [{ ...incident, asset_id: 6, asset_name: 'hmi-02' }] } });
    fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'medium' } });
    await screen.findByText('hmi-02');
    await act(async () => { resolveOld({ data: { incidents: [incident] } }); });
    expect(screen.queryByText('plc-01')).toBeNull();
    expect(screen.getByText('hmi-02')).toBeTruthy();
  });

  it('blocks export when no filtered incidents match', async () => {
    get.mockResolvedValue({ data: { incidents: [] } });
    renderPage();
    await screen.findByText('No incidents');
    expect((screen.getByRole('button', { name: 'Export filtered CSV' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

it('retries failed incident evidence without collapsing the incident or reloading its list', async () => {
  let fail = true;
  let resolve!: (value: unknown) => void;
  get.mockImplementation(url => {
    if (url === '/incidents') return Promise.resolve({ data: { incidents: [incident] } });
    return fail ? Promise.reject(new Error('Timeline store unavailable')) : new Promise(done => { resolve = done; });
  });
  renderPage();
  fireEvent.click(await screen.findByText('plc-01'));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry incident timeline' }));
  // A repeated failure remains a failure, never a claim of empty evidence.
  expect(await screen.findByRole('button', { name: 'Retry incident timeline' })).toBeTruthy();
  expect(screen.queryByText('No timeline events')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry incident timeline' }));
  expect(screen.getByText('Loading timeline...')).toBeTruthy();
  expect(screen.getByText('PLC compromise')).toBeTruthy();
  await act(async () => resolve({ data: { events: [{ kind: 'alert_updated', alert_id: 11, title: 'Retained timeline update', detail: 'Recorded change', timestamp: null }] } }));
  expect(screen.getByText(/Retained timeline update/)).toBeTruthy();
  expect(get.mock.calls.filter(([url]) => url === '/incidents')).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
});
