import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Topology } from './Topology';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

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
