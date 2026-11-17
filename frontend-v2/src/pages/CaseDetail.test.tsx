import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaseDetail } from './CaseDetail';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPatch = vi.mocked(apiClient.patch);
const mockPost = vi.mocked(apiClient.post);

const caseData = {
  id: 7,
  title: 'Suspicious lateral movement',
  summary: 'Correlated brute force and discovery activity',
  severity: 'high',
  status: 'open',
  confidence_score: 0.82,
  mitre_tactics: ['lateral-movement'],
  mitre_techniques: [{ id: 'T1021', name: 'Remote Services', confidence: 0.9 }],
  attack_narrative: null,
  created_by: 'agent',
  created_at: '2026-11-16T08:00:00Z',
  alert_count: 3,
  event_count: 12,
  timeline: [],
};

function mockLoad(status = 'open') {
  mockGet.mockImplementation(url => {
    if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
    if (url.endsWith('/events')) return Promise.resolve({ data: [] });
    if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: blastRadius } });
    if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: similarCases } });
    return Promise.resolve({ data: { ...caseData, status } });
  });
}

const blastRadius = {
  case_id: 7,
  nodes: [
    { id: 'case-7', type: 'case', label: 'Suspicious lateral movement', severity: 'high' },
    { id: 'asset-3', type: 'asset', label: 'scada-historian', asset_type: 'server', zone: 'plant', is_ot: true, criticality: 'high' },
    { id: 'ip-10.0.4.9', type: 'ip', label: '10.0.4.9', direction: 'source' },
  ],
  edges: [],
  summary: { total_nodes: 3, assets_affected: 1, ips_involved: 1, techniques_used: 0 },
};

const similarCases = [
  { case_id: 4, title: 'Prior brute force campaign', similarity: 0.73, shared_techniques: ['T1110', 'T1021'] },
];

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/cases/7']}>
      <Routes>
        <Route path="/cases/:caseId" element={<CaseDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('Case status transitions', () => {
  it('offers the forward actions for an open case and applies one', async () => {
    mockLoad();
    mockPatch.mockResolvedValue({ data: { success: true } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Start investigating' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith(
      '/cases/7', null, { params: { status_update: 'investigating' } },
    ));
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
  });

  it('offers close and reopen for a resolved case', async () => {
    mockLoad('resolved');
    renderDetail();
    expect(await screen.findByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('shows an error toast and keeps the current status when the update fails', async () => {
    mockLoad();
    mockPatch.mockRejectedValue(new Error('Conflict'));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    // Still showing the open-case actions; no crash, badge unchanged.
    expect(await screen.findByRole('button', { name: 'Start investigating' })).toBeTruthy();
  });
});

describe('Blast radius and similar investigations', () => {
  it('shows affected assets, IP counts and similar cases', async () => {
    mockLoad();
    renderDetail();
    await screen.findByText('Blast Radius');
    expect(screen.getByText('1 assets affected')).toBeTruthy();
    expect(screen.getByText('1 IPs involved')).toBeTruthy();
    expect(screen.getByText('scada-historian')).toBeTruthy();
    expect(screen.getByText('10.0.4.9')).toBeTruthy();
    await screen.findByText('Similar Investigations');
    const link = screen.getByRole('link', { name: /Prior brute force campaign/ });
    expect(link.getAttribute('href')).toBe('/cases/4');
    expect(screen.getByText('73% similar')).toBeTruthy();
    expect(screen.getByText(/T1110, T1021/)).toBeTruthy();
  });

  it('hides both panels when the case has no graph or similar cases', async () => {
    mockGet.mockImplementation(url => {
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: { ...blastRadius, nodes: blastRadius.nodes.slice(0, 1), summary: { total_nodes: 1, assets_affected: 0, ips_involved: 0, techniques_used: 0 } } } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      if (url.endsWith('/alerts') || url.endsWith('/events')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/7/similar'));
    expect(screen.queryByText('Blast Radius')).toBeNull();
    expect(screen.queryByText('Similar Investigations')).toBeNull();
  });

  it('keeps the page intact when the graph and similar requests fail', async () => {
    mockGet.mockImplementation(url => {
      if (url.endsWith('/blast-radius') || url.endsWith('/similar')) return Promise.reject(new Error('offline'));
      if (url.endsWith('/alerts') || url.endsWith('/events')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/7/similar'));
    expect(screen.queryByText('Blast Radius')).toBeNull();
    expect(screen.getByText('Investigation Timeline')).toBeTruthy();
  });
});

describe('Timeline notes', () => {
  it('posts a note and refreshes the timeline', async () => {
    mockLoad();
    mockPost.mockResolvedValue({ data: { id: 99, entry_type: 'note', content: 'Host reimaged.', source: 'human', timestamp: '2026-11-17T09:00:00Z' } });
    renderDetail();
    await screen.findByText('Investigation Timeline');
    fireEvent.change(screen.getByLabelText('Add a timeline note'), { target: { value: 'Host reimaged.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/notes', { content: 'Host reimaged.' }));
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
    expect((screen.getByLabelText('Add a timeline note') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps Add note disabled until text is entered', async () => {
    mockLoad();
    renderDetail();
    await screen.findByText('Investigation Timeline');
    const button = screen.getByRole('button', { name: 'Add note' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Add a timeline note'), { target: { value: 'Checking pcap' } });
    expect(button.disabled).toBe(false);
  });
});

describe('Linking alerts to the case', () => {
  const recentAlerts = [
    { id: 11, title: 'Suspicious login burst', severity: 'high' },
    { id: 12, title: 'Old firmware on PLC', severity: 'medium' },
  ];

  function mockLoadWithRecentAlerts() {
    mockGet.mockImplementation(url => {
      if (url === '/alerts/') return Promise.resolve({ data: { alerts: recentAlerts, total: 2 } });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [{ id: 11, severity: 'high', title: 'Suspicious login burst' }] });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
  }

  it('links a selected alert and refreshes the case', async () => {
    mockLoadWithRecentAlerts();
    mockPost.mockResolvedValue({ data: { success: true, data: { linked: true } } });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: /link alert/i }));
    const select = await screen.findByLabelText('Alert to link');
    // Alert 11 is already linked, so only alert 12 is offered.
    expect(screen.queryByRole('option', { name: /Suspicious login burst/ })).toBeNull();
    fireEvent.change(select, { target: { value: '12' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Link alert' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/alerts/12'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
  });

  it('notes when every recent alert is already linked', async () => {
    mockGet.mockImplementation(url => {
      if (url === '/alerts/') return Promise.resolve({ data: { alerts: recentAlerts, total: 2 } });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: recentAlerts });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: /link alert/i }));
    expect(await screen.findByText('Every recent alert is already linked.')).toBeTruthy();
  });
});

describe('Linking events to the case', () => {
  const recentEvents = [
    { id: 21, event_type: 'alert', severity: 'high', signature: 'ET SCAN Nmap', source_ip: '10.0.4.9', dest_ip: '10.0.4.20' },
    { id: 22, event_type: 'dns', severity: 'medium', signature: null, source_ip: '10.0.4.20', dest_ip: '8.8.8.8' },
  ];

  function mockLoadWithRecentEvents() {
    mockGet.mockImplementation(url => {
      if (url === '/events/') return Promise.resolve({ data: { events: recentEvents, total: 2 } });
      if (url.endsWith('/events')) return Promise.resolve({ data: [{ id: 21, event_type: 'alert', severity: 'high', signature: 'ET SCAN Nmap' }] });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
  }

  it('links a selected event and refreshes the case', async () => {
    mockLoadWithRecentEvents();
    mockPost.mockResolvedValue({ data: { success: true, data: { linked: true } } });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: /link event/i }));
    const select = await screen.findByLabelText('Event to link');
    // Event 21 is already linked, so only event 22 is offered.
    expect(screen.queryByRole('option', { name: /ET SCAN Nmap/ })).toBeNull();
    fireEvent.change(select, { target: { value: '22' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Link event' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/events/22'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
  });

  it('notes when every recent event is already linked', async () => {
    mockGet.mockImplementation(url => {
      if (url === '/events/') return Promise.resolve({ data: { events: recentEvents, total: 2 } });
      if (url.endsWith('/events')) return Promise.resolve({ data: recentEvents });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: /link event/i }));
    expect(await screen.findByText('Every recent event is already linked.')).toBeTruthy();
  });
});
