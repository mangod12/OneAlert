import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert, AlertListResponse } from '../api/types';
import { Alerts } from './Alerts';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    cve_id: 'CVE-2026-0001',
    title: 'Test vulnerability',
    description: 'A test description',
    severity: 'critical',
    status: 'pending',
    source: 'NVD',
    cvss_score: 9.8,
    asset_id: 10,
    asset_name: 'edge-router-01',
    asset_vendor: 'Acme',
    asset_product: 'RouterOS',
    remediation: 'Patch to 7.1',
    created_at: '2026-11-10T08:00:00Z',
    acknowledged_at: null,
    ...overrides,
  };
}

function listResponse(alerts: Alert[], pages = 1): { data: AlertListResponse } {
  return { data: { alerts, total: alerts.length, page: 1, size: 15, pages } };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockGet.mockResolvedValue(listResponse([makeAlert()]));
  mockPost.mockResolvedValue({ data: {} });
});

describe('Alerts page', () => {
  it('renders alert rows after loading', async () => {
    render(<Alerts />);
    expect(await screen.findByText('CVE-2026-0001')).toBeTruthy();
    expect(screen.getByText('critical')).toBeTruthy();
    expect(screen.getByText('edge-router-01')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/alerts/', { params: { page: 1, size: 15 } });
  });

  it('shows an error state and retries on demand', async () => {
    mockGet.mockReset();
    mockGet.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: {} } });
    mockGet.mockResolvedValueOnce(listResponse([makeAlert()]));
    render(<Alerts />);
    expect(await screen.findByText('Alerts could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('CVE-2026-0001')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('refetches with the severity filter applied', async () => {
    render(<Alerts />);
    await screen.findByText('CVE-2026-0001');
    const severitySelect = screen.getByRole('combobox', { name: 'Filter by severity' });
    fireEvent.change(severitySelect, { target: { value: 'high' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenLastCalledWith('/alerts/', {
        params: { page: 1, size: 15, severity: 'high' },
      });
    });
  });

  it('labels the search input and both filter selects for assistive tech', async () => {
    render(<Alerts />);
    await screen.findByText('CVE-2026-0001');
    expect(screen.getByRole('textbox', { name: 'Search by CVE ID' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by severity' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy();
  });

  it('opens the detail panel on row click and closes it', async () => {
    render(<Alerts />);
    fireEvent.click(await screen.findByText('CVE-2026-0001'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('A test description')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close alert details/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('opens the detail panel with the keyboard', async () => {
    render(<Alerts />);
    const cveCell = await screen.findByText('CVE-2026-0001');
    const row = cveCell.closest('tr');
    expect(row?.tabIndex).toBe(0);
    fireEvent.keyDown(row as HTMLElement, { key: 'Enter' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close alert details/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.keyDown(row as HTMLElement, { key: ' ' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('does not open the detail panel when the row checkbox handles the key', async () => {
    render(<Alerts />);
    const checkbox = await screen.findByRole('checkbox', { name: /select alert cve-2026-0001/i });
    fireEvent.keyDown(checkbox, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('acknowledges a pending alert from the detail panel', async () => {
    render(<Alerts />);
    fireEvent.click(await screen.findByText('CVE-2026-0001'));
    fireEvent.click(await screen.findByRole('button', { name: /acknowledge alert/i }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/alerts/1/acknowledge');
    });
    await waitFor(() => {
      const listCalls = mockGet.mock.calls.filter(([url]) => url === '/alerts/');
      expect(listCalls).toHaveLength(2);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('bulk-acknowledges selected alerts', async () => {
    const alerts = [makeAlert({ id: 1, cve_id: 'CVE-2026-0001' }), makeAlert({ id: 2, cve_id: 'CVE-2026-0002' })];
    mockGet.mockResolvedValue(listResponse(alerts));
    render(<Alerts />);
    await screen.findByText('CVE-2026-0002');
    fireEvent.click(screen.getByRole('checkbox', { name: /select all alerts/i }));
    fireEvent.click(screen.getByRole('button', { name: /acknowledge \(2\)/i }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/alerts/1/acknowledge');
      expect(mockPost).toHaveBeenCalledWith('/alerts/2/acknowledge');
    });
  });
});
