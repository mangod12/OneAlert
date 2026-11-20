import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Topology } from './Topology';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const del = vi.mocked(apiClient.delete);

const graph = {
  nodes: [
    { id: '10.0.1.5', label: 'scada-historian', type: 'device', zone: 'plant', risk_score: 42 },
    { id: '10.0.0.1', label: 'plant-gateway', type: 'gateway', zone: 'plant', risk_score: 0 },
    { id: '192.168.1.10', label: 'eng-ws-04', type: 'device', zone: 'corporate', risk_score: 0 },
  ],
  edges: [
    { source: '10.0.1.5', target: '10.0.0.1', protocol: 'modbus', is_encrypted: false, port: 502 },
    { source: '192.168.1.10', target: '10.0.0.1', protocol: 'https', is_encrypted: true, port: 443 },
  ],
};
const stats = { total_connections: 2, by_protocol: { modbus: 1, https: 1 }, encrypted: 1, unencrypted: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/topology/graph') return { data: graph };
    if (url === '/topology/stats') return { data: stats };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Topology page', () => {
  it('groups nodes by zone with type badges and risk scores', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    expect(screen.getByText('plant')).toBeTruthy();
    expect(screen.getByText('corporate')).toBeTruthy();
    expect(screen.getByText('gateway')).toBeTruthy();
    expect(screen.getByText('risk 42')).toBeTruthy();
  });

  it('shows connection stats and flags cleartext connections', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('Cleartext')).toBeTruthy();
    expect(screen.getAllByText('Encrypted').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/modbus/i).length).toBeGreaterThan(0);
  });

  it('filters connections by protocol', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter connections by protocol' }), { target: { value: 'modbus' } });
    expect(screen.getByText('1 of 2 connections')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows.some(r => r.textContent?.includes('modbus'))).toBe(true);
    expect(rows.some(r => r.textContent?.includes('https'))).toBe(false);
  });

  it('filters to cleartext connections only', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cleartext only' }));
    expect(screen.getByText('1 of 2 connections')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows.some(r => r.textContent?.includes('Cleartext'))).toBe(true);
    expect(rows.some(r => r.textContent?.includes('https'))).toBe(false);
  });

  it('shows a no-match note when filters exclude every connection', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter connections by protocol' }), { target: { value: 'https' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cleartext only' }));
    expect(await screen.findByText('No connections match the current filters.')).toBeTruthy();
  });

  it('filters connections to the selected node', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    fireEvent.click(screen.getByRole('button', { name: /scada-historian/ }));
    expect(screen.getByText('Connections for scada-historian')).toBeTruthy();
    expect(screen.getByText('1 of 2 connections')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows.some(r => r.textContent?.includes('modbus'))).toBe(true);
    expect(rows.some(r => r.textContent?.includes('https'))).toBe(false);
  });

  it('clears the node filter from the chip or by re-clicking the node', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    const nodeButton = screen.getByRole('button', { name: /scada-historian/ });
    fireEvent.click(nodeButton);
    expect(screen.getByText('1 of 2 connections')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear node filter for scada-historian' }));
    expect(screen.queryByText(/of 2 connections/)).toBeNull();
    expect(screen.getAllByRole('row').some(r => r.textContent?.includes('https'))).toBe(true);

    fireEvent.click(nodeButton);
    expect(screen.getByText('1 of 2 connections')).toBeTruthy();
    fireEvent.click(nodeButton);
    expect(screen.queryByText(/of 2 connections/)).toBeNull();
  });

  it('combines the node filter with the protocol filter', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    fireEvent.click(screen.getByRole('button', { name: /plant-gateway/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter connections by protocol' }), { target: { value: 'https' } });
    expect(screen.getByText('1 of 2 connections')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows.some(r => r.textContent?.includes('https'))).toBe(true);
    expect(rows.some(r => r.textContent?.includes('modbus'))).toBe(false);
  });

  it('shows the empty state when nothing has been observed', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/topology/graph') return { data: { nodes: [], edges: [] } };
      if (url === '/topology/stats') return { data: { total_connections: 0, by_protocol: {}, encrypted: 0, unencrypted: 0 } };
      throw new Error(`unexpected ${url}`);
    });
    render(<Topology />);
    await screen.findByText(/No topology observed yet/);
  });
});

describe('Add connection', () => {
  async function openForm() {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  }

  it('records a connection with the parsed port and refreshes the topology', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Source IP *'), { target: { value: '10.0.3.7' } });
    fireEvent.change(screen.getByLabelText('Target IP *'), { target: { value: '10.0.0.1' } });
    fireEvent.change(screen.getByLabelText('Protocol *'), { target: { value: 's7comm' } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '102' } });
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'outbound' } });
    fireEvent.click(screen.getByLabelText('Encrypted'));
    fireEvent.click(screen.getByRole('button', { name: 'Record connection' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/topology/connections', {
      source_ip: '10.0.3.7',
      target_ip: '10.0.0.1',
      protocol: 's7comm',
      port: 102,
      direction: 'outbound',
      is_encrypted: true,
    }));
    expect(await screen.findByText(/Connection recorded/)).toBeTruthy();
  });

  it('requires source, target and protocol', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Record connection' }));
    expect(await screen.findByText(/Source IP, target IP and protocol are required/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a port outside the valid range', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Source IP *'), { target: { value: '10.0.3.7' } });
    fireEvent.change(screen.getByLabelText('Target IP *'), { target: { value: '10.0.0.1' } });
    fireEvent.change(screen.getByLabelText('Protocol *'), { target: { value: 's7comm' } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record connection' }));
    expect(await screen.findByText(/between 0 and 65535/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('Remove connection', () => {
  const graphWithIds = {
    ...graph,
    edges: [
      { id: 101, source: '10.0.1.5', target: '10.0.0.1', protocol: 'modbus', is_encrypted: false, port: 502 },
      { id: 102, source: '192.168.1.10', target: '10.0.0.1', protocol: 'https', is_encrypted: true, port: 443 },
    ],
  };

  function mockWithIds() {
    get.mockImplementation(async (url: string) => {
      if (url === '/topology/graph') return { data: graphWithIds };
      if (url === '/topology/stats') return { data: stats };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('removes a connection after confirmation and refreshes the topology', async () => {
    mockWithIds();
    del.mockResolvedValue({ data: null });
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    get.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Remove connection 10\.0\.1\.5/ }));
    expect(await screen.findByText(/no longer appears in the topology or stats/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/topology/connections/101'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/topology/graph'));
    expect(get).toHaveBeenCalledWith('/topology/stats');
  });

  it('keeps the connection when the dialog is cancelled', async () => {
    mockWithIds();
    render(<Topology />);
    await screen.findAllByText('scada-historian');

    fireEvent.click(screen.getByRole('button', { name: /Remove connection 10\.0\.1\.5/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(del).not.toHaveBeenCalled();
  });

  it('hides the remove action for edges without a connection id', async () => {
    render(<Topology />);
    await screen.findAllByText('scada-historian');
    expect(screen.queryByRole('button', { name: /Remove connection/ })).toBeNull();
  });
});

it('keeps graph and connection filters available when optional statistics fail, then retries', async () => {
  let fail = true;
  get.mockImplementation(async url => {
    if (url === '/topology/graph') return { data: graph };
    if (fail) throw new Error('Stats temporarily unavailable');
    return { data: stats };
  });
  render(<Topology />);
  await screen.findAllByText('scada-historian');
  expect(screen.queryByText('Topology unavailable')).toBeNull();
  expect(screen.getByText('Some live data is unavailable')).toBeTruthy();
  expect(screen.queryByText('50%')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Cleartext only' }));
  expect(screen.getByText('1 of 2 connections')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('50%')).toBeTruthy();
  expect(screen.queryByText('Some live data is unavailable')).toBeNull();
  expect(screen.getByText('1 of 2 connections')).toBeTruthy();
});

it('does not present missing graph data as an empty topology even when statistics load', async () => {
  get.mockImplementation(url => url === '/topology/graph' ? Promise.reject(new Error('Graph failed')) : Promise.resolve({ data: stats }));
  render(<Topology />);
  expect(await screen.findByText('Topology unavailable')).toBeTruthy();
  expect(screen.queryByText(/No topology observed yet/)).toBeNull();
});

it('keeps wide connection tables in a keyboard-focusable horizontal scroll region', async () => {
  render(<Topology />);
  const region = await screen.findByRole('region', { name: 'Topology connections' });
  expect(region.tabIndex).toBe(0);
  expect(region.classList.contains('overflow-x-auto')).toBe(true);
  expect(region.contains(screen.getByRole('table'))).toBe(true);
  region.focus();
  expect(document.activeElement).toBe(region);
});
