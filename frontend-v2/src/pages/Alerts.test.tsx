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
    acknowledged_at: null, assigned_to_id: null, assigned_to_email: null,
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
    expect(mockGet).toHaveBeenCalledWith('/alerts/', { params: { page: 1, size: 15, sort: 'created_at_desc' } });
  });

  it('shows an error state and retries on demand', async () => {
    mockGet.mockReset();
    let alertCalls = 0;
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/assets/') return { data: { assets: [], total: 0 } };
      if (url === '/alerts/epss-batch') return { data: { scores: {} } };
      alertCalls += 1;
      if (alertCalls === 1) throw { isAxiosError: true, response: { status: 500, data: {} } };
      return listResponse([makeAlert()]);
    });
    render(<Alerts />);
    expect(await screen.findByText('Alerts could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('CVE-2026-0001')).toBeTruthy();
    expect(alertCalls).toBe(2);
  });

  it('refetches with the severity filter applied', async () => {
    render(<Alerts />);
    await screen.findByText('CVE-2026-0001');
    const severitySelect = screen.getByRole('combobox', { name: 'Filter by severity' });
    fireEvent.change(severitySelect, { target: { value: 'high' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenLastCalledWith('/alerts/', {
        params: { page: 1, size: 15, severity: 'high', sort: 'created_at_desc' },
      });
    });
  });

  it('labels the search input and both filter selects for assistive tech', async () => {
    render(<Alerts />);
    await screen.findByText('CVE-2026-0001');
    expect(screen.getByRole('textbox', { name: 'Search by CVE or title' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by severity' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy();
  });

  it('filters by asset from the dropdown', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/assets/') return { data: { assets: [{ id: 10, name: 'edge-router-01' }], total: 1 } };
      return listResponse([makeAlert()]);
    });
    render(<Alerts />);
    const select = await screen.findByRole('combobox', { name: 'Filter by asset' });
    fireEvent.change(select, { target: { value: '10' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/alerts/', {
        params: { page: 1, size: 15, asset_id: 10, sort: 'created_at_desc' },
      });
    });
  });

  it('sends the search text as a substring query', async () => {
    render(<Alerts />);
    const input = await screen.findByRole('textbox', { name: 'Search by CVE or title' });
    fireEvent.change(input, { target: { value: 'routeros' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/alerts/', {
        params: { page: 1, size: 15, search: 'routeros', sort: 'created_at_desc' },
      });
    });
  });

  it('sends the chosen sort order to the API', async () => {
    render(<Alerts />);
    const select = await screen.findByRole('combobox', { name: 'Sort alerts' });
    fireEvent.change(select, { target: { value: 'cvss_desc' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/alerts/', {
        params: { page: 1, size: 15, sort: 'cvss_desc' },
      });
    });
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

describe('Assignee filter', () => {
  it('sends assigned=me when "Assigned to me" is selected', async () => {
    render(<Alerts />);
    await screen.findByRole('combobox', { name: 'Filter by status' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by assignee' }), { target: { value: 'me' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/alerts/', {
        params: { page: 1, size: 15, assigned: 'me', sort: 'created_at_desc' },
      });
    });
  });
});

describe('Alerts CSV export', () => {
  it('downloads the CSV with the active filters', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:alerts');
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreate(tag, options);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', { set: (v: string) => clicks.push(v), configurable: true });
        el.click = () => clicks.push('clicked');
      }
      return el;
    });
    render(<Alerts />);
    await screen.findByRole('combobox', { name: 'Filter by status' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by assignee' }), { target: { value: 'me' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/alerts/', {
      params: { page: 1, size: 15, assigned: 'me', sort: 'created_at_desc' },
    }));
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/alerts/export', { params: { assigned: 'me' }, responseType: 'blob' }));
    await waitFor(() => expect(clicks).toContain('alerts.csv'));
  });
});

describe('EPSS badges', () => {
  it('shows the exploit probability under the CVE when EPSS data arrives', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/alerts/epss-batch') return Promise.resolve({ data: { scores: { 'CVE-2026-0001': { score: 0.97, percentile: 0.99 } } } });
      if (url === '/assets/') return Promise.resolve({ data: { assets: [] } });
      return Promise.resolve(listResponse([makeAlert()]));
    });
    render(<Alerts />);
    expect(await screen.findByText('EPSS 97%')).toBeTruthy();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/alerts/epss-batch', { params: { cve_ids: 'CVE-2026-0001' } }));
  });

  it('renders the list without badges when the EPSS lookup fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/alerts/epss-batch') return Promise.reject(new Error('upstream down'));
      if (url === '/assets/') return Promise.resolve({ data: { assets: [] } });
      return Promise.resolve(listResponse([makeAlert()]));
    });
    render(<Alerts />);
    expect(await screen.findByText('CVE-2026-0001')).toBeTruthy();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/alerts/epss-batch', { params: { cve_ids: 'CVE-2026-0001' } }));
    expect(screen.queryByText(/EPSS/)).toBeNull();
  });
});
