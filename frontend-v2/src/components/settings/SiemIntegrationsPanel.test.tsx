import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { SiemIntegrationsPanel } from './SiemIntegrationsPanel';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const patch = vi.mocked(apiClient.patch);
const del = vi.mocked(apiClient.delete);

const types = [
  { type: 'splunk', name: 'Splunk', description: 'Splunk HTTP Event Collector' },
  { type: 'sentinel', name: 'Microsoft Sentinel', description: 'Azure Log Analytics Data Collector' },
  { type: 'servicenow', name: 'ServiceNow', description: 'ServiceNow incident creation' },
  { type: 'pagerduty', name: 'PagerDuty', description: 'PagerDuty incident triggering' },
];

const integrations = [
  { id: 1, integration_type: 'splunk', name: 'Prod Splunk', config: { hec_url: 'https://s.example.com:8088', hec_token: 'secret' }, is_active: true, created_at: '2026-11-01T00:00:00Z' },
  { id: 2, integration_type: 'pagerduty', name: 'Oncall PD', config: { routing_key: 'secret' }, is_active: false, created_at: '2026-11-02T00:00:00Z' },
];

beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/integrations/types') return { data: { data: types } };
    if (url === '/integrations/') return { data: { data: integrations } };
    throw new Error(`unexpected ${url}`);
  });
  post.mockResolvedValue({ data: { success: true } });
  patch.mockResolvedValue({ data: { success: true } });
  del.mockResolvedValue({ data: { success: true } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SiemIntegrationsPanel', () => {
  it('lists integrations with type names and active state, without exposing config values', async () => {
    render(<SiemIntegrationsPanel />);
    await screen.findByText('Prod Splunk');
    expect(screen.getByText('Oncall PD')).toBeTruthy();
    expect(screen.getByText('Splunk')).toBeTruthy();
    expect(screen.getByText('PagerDuty')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
    expect(screen.queryByText(/s\.example\.com/)).toBeNull();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it('creates a splunk integration with only the filled fields as config', async () => {
    render(<SiemIntegrationsPanel />);
    await screen.findByText('Prod Splunk');
    fireEvent.click(screen.getByRole('button', { name: /add integration/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'DR Splunk' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'splunk' } });
    fireEvent.change(screen.getByLabelText('HEC URL *'), { target: { value: 'https://dr.example.com:8088' } });
    fireEvent.change(screen.getByLabelText('HEC token *'), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save integration' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/integrations/', {
      integration_type: 'splunk',
      name: 'DR Splunk',
      config: { hec_url: 'https://dr.example.com:8088', hec_token: 'tok' },
    }));
    expect(await screen.findByText('Splunk integration added.')).toBeTruthy();
  });

  it('requires every mandatory field before saving', async () => {
    render(<SiemIntegrationsPanel />);
    await screen.findByText('Prod Splunk');
    fireEvent.click(screen.getByRole('button', { name: /add integration/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Snow' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'servicenow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save integration' }));
    expect(await screen.findByText(/every required field/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('runs the connection test and reports the result', async () => {
    render(<SiemIntegrationsPanel />);
    await screen.findByText('Prod Splunk');
    fireEvent.click(screen.getAllByRole('button', { name: 'Test' })[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/integrations/1/test'));
    expect(await screen.findByText('Prod Splunk connected successfully.')).toBeTruthy();
  });

  it('toggles an integration off and deletes one through the confirm dialog', async () => {
    render(<SiemIntegrationsPanel />);
    await screen.findByText('Prod Splunk');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/integrations/1', { is_active: false }));
    fireEvent.click(screen.getByLabelText('Delete Oncall PD'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete integration' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/integrations/2'));
  });
});
