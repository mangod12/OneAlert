import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaseDetail } from './CaseDetail';

vi.mock('../api/client', () => ({
  SESSION_EXPIRED_EVENT: 'onealert:session-expired',
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';

const mockGet = vi.mocked(apiClient.get);
const mockPatch = vi.mocked(apiClient.patch);
const mockPost = vi.mocked(apiClient.post);
const mockDelete = vi.mocked(apiClient.delete);

const caseData = {
  id: 7,
  user_id: 5,
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

function reviewedLink(kind: 'alert' | 'event', id: number) {
  const common = { case: { id: 7, title: caseData.title, summary: caseData.summary, severity: 'high', status: 'open', due_date: null, closed_at: null, assigned_to_id: null }, reviewed_fingerprint: 'b'.repeat(64), already_linked: false };
  return kind === 'alert' ? { ...common, alert: { id, title: 'Current saved alert', description: null, created_at: '2026-01-01T00:00:00Z', status: 'pending', severity: 'critical', cve_id: null, asset_id: null }, alert_fingerprint: 'a'.repeat(64), resulting_severity: 'critical' } : { ...common, event: { id, signature: 'Current saved event', event_type: 'dns', timestamp: '2026-01-01T00:00:00Z', severity: 'medium', processed: 'pending', source_ip: null, dest_ip: null }, event_fingerprint: 'a'.repeat(64) };
}

function mockLoad(status = 'open') {
  mockGet.mockImplementation(url => {
    if (url.endsWith('/closeout-review')) return Promise.resolve({ data: { case_id: 7, title: caseData.title, status: 'open', target_status: 'resolved', resolution: null, can_edit_resolution: true, open_tasks: [], task_total: 0, remaining_alerts: [], alert_total: 0, unavailable_alert_links: 0, reviewed_fingerprint: 'a'.repeat(64) } });
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
    if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
    if (url.endsWith('/events')) return Promise.resolve({ data: [] });
    if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: blastRadius } });
    if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: similarCases } });
    return Promise.resolve({ data: { ...caseData, status } });
  });
}

function mockLoadWithPlans(plans: Array<Record<string, unknown>>) {
  mockGet.mockImplementation(url => {
    if (url.endsWith('/tasks')) return Promise.resolve({ data: [] });
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
    if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
    if (url.endsWith('/events')) return Promise.resolve({ data: [] });
    if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: blastRadius } });
    if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: similarCases } });
    if (url === '/response-plans/') return Promise.resolve({ data: { data: plans.map(plan => ({ ...plan, case_id: 7 })), total: plans.length } });
    return Promise.resolve({ data: caseData });
  });
}

function mockLoadWithTimeline(timeline: Array<Record<string, unknown>>) {
  mockGet.mockImplementation(url => {
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
    if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
    if (url.endsWith('/events')) return Promise.resolve({ data: [] });
    if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: blastRadius } });
    if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: similarCases } });
    return Promise.resolve({ data: { ...caseData, timeline } });
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

function renderDetail(path = '/cases/7') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/cases/:caseId" element={<CaseDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.resetAllMocks(); useAuthStore.setState({ user: { id: 5, email: 'owner@example.com', full_name: 'Owner', company: 'Acme', role: 'analyst', is_active: true, is_verified: true, mfa_enabled: false, created_at: '2026-01-01T00:00:00Z' } }); });
afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
});

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
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(/Resolution summary/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
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
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
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
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
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

describe('Editing timeline notes', () => {
  const noteEntry = { id: 21, entry_type: 'note', content: 'Original note', source: 'human', timestamp: '2026-11-17T09:00:00Z', metadata_json: null };
  const actionEntry = { id: 22, entry_type: 'action', content: 'Containment ran', source: 'agent', timestamp: '2026-11-17T09:05:00Z', metadata_json: null };

  it('offers edit only on note entries and patches the note on save', async () => {
    mockLoadWithTimeline([noteEntry, actionEntry]);
    mockPatch.mockResolvedValue({ data: { ...noteEntry, content: 'Rewritten note' } });
    renderDetail();
    await screen.findByText('Original note');
    expect(screen.getAllByRole('button', { name: 'Edit note' }).length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    const box = screen.getByLabelText('Edit note') as HTMLTextAreaElement;
    expect(box.value).toBe('Original note');
    fireEvent.change(box, { target: { value: 'Rewritten note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/notes/21', { content: 'Rewritten note' }));
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
  });

  it('highlights the deep-linked note entry', async () => {
    mockLoadWithTimeline([noteEntry, actionEntry]);
    render(
      <MemoryRouter initialEntries={['/cases/7?note=21']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Original note');
    expect(document.getElementById('case-note-21')?.className).toContain('ring-2');
    expect(document.getElementById('case-note-22')?.className).not.toContain('ring-2');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find timeline evidence' }), { target: { value: 'no matching content' } });
    expect(document.getElementById('case-note-21')).toBeTruthy();
    expect(document.getElementById('case-note-22')).toBeNull();
    expect(screen.getByText(/linked or edited entry is kept visible/)).toBeTruthy();
  });

  it('keeps an active note edit visible while timeline filters change', async () => {
    mockLoadWithTimeline([noteEntry, actionEntry]);
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'Unsaved draft' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find timeline evidence' }), { target: { value: 'no match' } });
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('Unsaved draft');
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('cancel leaves the note untouched', async () => {
    mockLoadWithTimeline([noteEntry]);
    renderDetail();
    await screen.findByText('Original note');
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'Changed but cancelled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Original note')).toBeTruthy();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('marks edited notes with an (edited) badge', async () => {
    mockLoadWithTimeline([{ ...noteEntry, content: 'Fixed later', metadata_json: { edited: true } }]);
    renderDetail();
    await screen.findByText('Fixed later');
    expect(screen.getByText('(edited)')).toBeTruthy();
  });
});

describe('Linking alerts to the case', () => {
  const recentAlerts = [
    { id: 11, title: 'Suspicious login burst', severity: 'high' },
    { id: 12, title: 'Old firmware on PLC', severity: 'medium' },
  ];

  function mockLoadWithRecentAlerts() {
    mockGet.mockImplementation(url => {
      if (url === '/alerts/12/existing-investigations/7/preview') return Promise.resolve({ data: reviewedLink('alert', 12) });
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url.endsWith('/evidence-candidates')) return Promise.resolve({ data: { data: [{ id: 12, kind: 'alert', title: 'New exposure', severity: 'critical' }], total: 1, page: 1, size: 10, kind: 'alert', case_id: 7 } });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [{ id: 11, severity: 'high', title: 'Suspicious login burst' }] });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
  }

  it('links a selected alert and refreshes the case', async () => {
    mockLoadWithRecentAlerts();
    mockPost.mockResolvedValue({ data: { case_id: 7, alert_id: 12, linked: true, created: true, reviewed_fingerprint: 'b'.repeat(64), severity: 'critical' } });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: 'Link alert' }));
    const radio = await screen.findByLabelText('Select alert #12');
    // Alert 11 is already linked, so only alert 12 is offered.
    expect(screen.queryByRole('option', { name: /Suspicious login burst/ })).toBeNull();
    fireEvent.click(radio);
    const dialog = within(screen.getByRole('dialog')); fireEvent.click(dialog.getByRole('button', { name: 'Review exact investigation link' })); await dialog.findByRole('checkbox'); expect(mockPost).not.toHaveBeenCalled(); fireEvent.click(dialog.getByRole('checkbox')); fireEvent.click(dialog.getByRole('button', { name: 'Save reviewed investigation link' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/alerts/12/existing-investigations/7', { reviewed_fingerprint: 'b'.repeat(64) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
  });

  it('closing an uncertain reviewed link refreshes the full case without repeating the write', async () => {
    mockLoadWithRecentAlerts(); mockPost.mockRejectedValueOnce(new Error('Uncertain outcome')); renderDetail(); await screen.findByText('Suspicious lateral movement'); fireEvent.click(screen.getByRole('button', { name: 'Link alert' })); await screen.findByLabelText('Select alert #12'); fireEvent.click(screen.getByLabelText('Select alert #12')); const dialog = within(screen.getByRole('dialog')); fireEvent.click(dialog.getByRole('button', { name: 'Review exact investigation link' })); await dialog.findByRole('checkbox'); fireEvent.click(dialog.getByRole('checkbox')); fireEvent.click(dialog.getByRole('button', { name: 'Save reviewed investigation link' })); await dialog.findByText(/No automatic retry was made/); fireEvent.click(dialog.getByRole('button', { name: 'Cancel and refresh investigation' })); await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2)); expect(mockPost).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains when no unlinked alerts match the current query', async () => {
    mockGet.mockImplementation(url => {
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url.endsWith('/evidence-candidates')) return Promise.resolve({ data: { data: [], total: 0, page: 1, size: 10, kind: 'alert', case_id: 7 } });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: recentAlerts });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: 'Link alert' }));
    expect(await screen.findByText(/No linkable records match this page/)).toBeTruthy();
  });
});

describe('Linking events to the case', () => {
  const recentEvents = [
    { id: 21, event_type: 'alert', severity: 'high', signature: 'ET SCAN Nmap', source_ip: '10.0.4.9', dest_ip: '10.0.4.20' },
    { id: 22, event_type: 'dns', severity: 'medium', signature: null, source_ip: '10.0.4.20', dest_ip: '8.8.8.8' },
  ];

  function mockLoadWithRecentEvents() {
    mockGet.mockImplementation(url => {
      if (url === '/events/22/existing-investigations/7/preview') return Promise.resolve({ data: reviewedLink('event', 22) });
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url.endsWith('/evidence-candidates')) return Promise.resolve({ data: { data: [{ id: 22, kind: 'event', title: 'DNS event', severity: 'medium' }], total: 1, page: 1, size: 10, kind: 'event', case_id: 7 } });
      if (url.endsWith('/events')) return Promise.resolve({ data: [{ id: 21, event_type: 'alert', severity: 'high', signature: 'ET SCAN Nmap' }] });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
  }

  it('links a selected event and refreshes the case', async () => {
    mockLoadWithRecentEvents();
    mockPost.mockResolvedValue({ data: { case_id: 7, event_id: 22, linked: true, created: true, reviewed_fingerprint: 'b'.repeat(64) } });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: 'Link event' }));
    const radio = await screen.findByLabelText('Select event #22');
    // Event 21 is already linked, so only event 22 is offered.
    expect(screen.queryByRole('option', { name: /ET SCAN Nmap/ })).toBeNull();
    fireEvent.click(radio);
    const dialog = within(screen.getByRole('dialog')); fireEvent.click(dialog.getByRole('button', { name: 'Review exact investigation link' })); await dialog.findByRole('checkbox'); expect(mockPost).not.toHaveBeenCalled(); fireEvent.click(dialog.getByRole('checkbox')); fireEvent.click(dialog.getByRole('button', { name: 'Save reviewed investigation link' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/events/22/existing-investigations/7', { reviewed_fingerprint: 'b'.repeat(64) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
  });

  it('explains when no unlinked events match the current query', async () => {
    mockGet.mockImplementation(url => {
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url.endsWith('/evidence-candidates')) return Promise.resolve({ data: { data: [], total: 0, page: 1, size: 10, kind: 'event', case_id: 7 } });
      if (url.endsWith('/events')) return Promise.resolve({ data: recentEvents });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: 'Link event' }));
    expect(await screen.findByText(/No linkable records match this page/)).toBeTruthy();
  });
});

describe('Unlinking related items', () => {
  function mockLoadWithLinked() {
    mockGet.mockImplementation(url => {
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [{ id: 11, severity: 'high', title: 'Suspicious login burst' }] });
      if (url.endsWith('/events')) return Promise.resolve({ data: [{ id: 21, event_type: 'alert', severity: 'high', signature: 'ET SCAN Nmap', source_ip: '10.0.4.9', dest_ip: '10.0.4.20' }] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
  }

  it.each([['alert', 11, 'Suspicious login burst'], ['event', 21, 'ET SCAN Nmap']])('reviews %s unlink with a reason, preserves evidence and refreshes the case', async (kind, id, label) => {
    mockLoadWithLinked();
    const oldGet = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url, config) => url.endsWith('/unlink-preview') ? Promise.resolve({ data: { case: { id: 7, title: caseData.title, summary: caseData.summary, status: 'open', severity: 'high', due_date: null, closed_at: null }, kind, record: { id, label, severity: 'high', recorded_at: null, processing_label: kind === 'event' ? 'in_case' : 'acknowledged' }, link_count: 1, other_owned_case_count: 0, record_fingerprint: 'b'.repeat(64), reviewed_fingerprint: 'a'.repeat(64) } }) : oldGet(url, config));
    mockPost.mockResolvedValue({ data: { case_id: 7, kind, record_id: id, unlinked: true, removed_link_rows: 1, reviewed_fingerprint: 'a'.repeat(64) } });
    renderDetail(); await screen.findByText(new RegExp(label));
    fireEvent.click(screen.getByRole('button', { name: `Unlink ${kind} ${label}` }));
    await screen.findByLabelText('Reason for unlinking'); expect(mockPost).not.toHaveBeenCalled(); expect(mockDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Unlink reviewed evidence' }); expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Reason for unlinking'), { target: { value: 'Reviewed unrelated evidence' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(confirm);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(`/cases/7/evidence/${kind}/${id}/unlink`, { reviewed_fingerprint: 'a'.repeat(64), reason: 'Reviewed unrelated evidence' }));
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2)); expect(mockDelete).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog', { name: 'Review evidence unlink' })).toBeNull();
  });

  it('closing an uncertain unlink review refreshes the full case without retrying', async () => {
    mockLoadWithLinked(); const oldGet = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url, config) => url.endsWith('/unlink-preview') ? Promise.resolve({ data: { case: { id: 7, title: caseData.title, summary: caseData.summary, status: 'open', severity: 'high', due_date: null, closed_at: null }, kind: 'event', record: { id: 21, label: 'ET SCAN Nmap', severity: 'high', recorded_at: null, processing_label: 'in_case' }, link_count: 1, other_owned_case_count: 0, record_fingerprint: 'b'.repeat(64), reviewed_fingerprint: 'a'.repeat(64) } }) : oldGet(url, config));
    mockPost.mockRejectedValueOnce(new Error('Network outcome unknown')); renderDetail(); await screen.findByText(/ET SCAN Nmap/); fireEvent.click(screen.getByRole('button', { name: 'Unlink event ET SCAN Nmap' })); await screen.findByLabelText('Reason for unlinking'); fireEvent.change(screen.getByLabelText('Reason for unlinking'), { target: { value: 'Reviewed unrelated event' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Unlink reviewed evidence' })); await screen.findByText(/No automatic retry was made/); fireEvent.click(screen.getByRole('button', { name: 'Cancel and refresh case' })); await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2)); expect(mockPost).toHaveBeenCalledTimes(1); expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('Source-bound evidence notes', () => {
  const sourceMetadata = { kind: 'reviewed_evidence_note', schema_version: 1, case_id: 7, record_kind: 'event', record_id: 21, record_fingerprint: 'b'.repeat(64), reviewed_fingerprint: 'a'.repeat(64), record_snapshot: { label_at_review: 'Saved source label', label_truncated: false, severity: 'high', recorded_at: null, processing_label: 'in_case' } };
  function loadEvidence() {
    let timeline: Array<Record<string, unknown>> = [];
    mockGet.mockImplementation(url => {
      if (url.endsWith('/source-comparison')) return Promise.resolve({ data: { schema_version: 1, case_id: 7, note_id: 99, kind: 'event', record_id: 21, saved_fingerprint: sourceMetadata.record_fingerprint, saved_snapshot: sourceMetadata.record_snapshot, source_available: true, current_fingerprint: sourceMetadata.record_fingerprint, current_snapshot: sourceMetadata.record_snapshot, revision_matches: true, changed_snapshot_fields: [], link_count: 1, retrieved_at: '2026-01-03T00:00:00Z' } });
      if (url.endsWith('/note-preview')) return Promise.resolve({ data: { case: { id: 7, title: caseData.title, summary: caseData.summary, status: 'open', severity: 'high', due_date: null, closed_at: null }, kind: 'event', record: { id: 21, label: 'Saved source label', severity: 'high', recorded_at: null, processing_label: 'in_case' }, link_count: 1, other_owned_case_count: 0, record_fingerprint: 'b'.repeat(64), reviewed_fingerprint: 'a'.repeat(64), note_count: 0, recent_notes: [] } });
      if (url === '/cases/7') return Promise.resolve({ data: { ...caseData, timeline } });
      if (url.endsWith('/events')) return Promise.resolve({ data: [{ id: 21, event_type: 'auth', severity: 'high', signature: 'Saved source label' }] });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [{ id: 11, title: 'Saved alert', severity: 'high' }] });
      if (url.endsWith('/blast-radius') || url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: null } });
      return Promise.resolve({ data: [] });
    });
    mockPost.mockImplementation(async (url, payload) => {
      if (url !== '/cases/7/evidence/event/21/notes') throw Error('Unexpected mutation');
      const { content } = payload as { content: string };
      timeline = [{ id: 99, timestamp: '2026-01-02T00:00:00Z', entry_type: 'note', source: 'human', author_email: 'owner@example.com', content, metadata_json: sourceMetadata }];
      return { data: { case_id: 7, kind: 'event', record_id: 21, note_id: 99, content, created: true, record_fingerprint: 'b'.repeat(64), reviewed_fingerprint: 'a'.repeat(64) } };
    });
  }
  it('starts from linked evidence, reviews exact source, saves once and refreshes to a highlighted readable source reference', async () => {
    loadEvidence(); renderDetail(); await screen.findByRole('button', { name: 'Note about event Saved source label' });
    expect(screen.getByRole('button', { name: 'Note about alert Saved alert' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Note about event Saved source label' })); await screen.findByLabelText('Evidence note'); expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Evidence note'), { target: { value: 'Analyst interpretation of this source' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Save reviewed evidence note' }));
    await screen.findByText('Analyst interpretation of this source'); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Saved source reference: event #21')).toBeTruthy(); expect(screen.getByRole('link', { name: /Open current original event #21/ }).getAttribute('href')).toBe('/app/events/21'); await waitFor(() => expect(document.getElementById('case-note-99')?.className).toContain('primary'));
    expect(mockGet.mock.calls.some(([url]) => url.endsWith('/source-comparison'))).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Compare saved source with current evidence' })); await screen.findByText(/fingerprints match in this read/); expect(mockGet).toHaveBeenCalledWith('/cases/7/notes/99/source-comparison');
    expect(mockPost).toHaveBeenCalledExactlyOnceWith('/cases/7/evidence/event/21/notes', { content: 'Analyst interpretation of this source', reviewed_fingerprint: 'a'.repeat(64) }); expect(mockPatch).not.toHaveBeenCalled(); expect(mockDelete).not.toHaveBeenCalled(); expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2);
  });
  it('closing a failed note refreshes the case without repeating a save or silently discarding source state', async () => {
    loadEvidence(); mockPost.mockRejectedValueOnce(new Error('Unknown outcome')); renderDetail(); fireEvent.click(await screen.findByRole('button', { name: 'Note about event Saved source label' })); await screen.findByLabelText('Evidence note'); fireEvent.change(screen.getByLabelText('Evidence note'), { target: { value: 'Kept draft' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Save reviewed evidence note' })); await screen.findByText(/No automatic retry was made/); fireEvent.click(screen.getByRole('button', { name: 'Cancel and refresh case' })); await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2)); expect(mockPost).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('watchers can read historical reference metadata but cannot start owner-only evidence annotations or open owner source links', async () => {
    mockLoadWithTimeline([{ id: 99, timestamp: '2026-01-02T00:00:00Z', entry_type: 'note', source: 'human', content: 'Retained analyst interpretation', metadata_json: sourceMetadata }]);
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: 6 } }); renderDetail(); await screen.findByText('Retained analyst interpretation'); expect(screen.getByText('Saved source reference: event #21')).toBeTruthy(); expect(screen.queryByRole('button', { name: /Note about (event|alert)/ })).toBeNull(); expect(screen.queryByRole('link', { name: /Open current original event/ })).toBeNull(); expect(screen.queryByRole('button', { name: 'Compare saved source with current evidence' })).toBeNull(); expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Case severity editing', () => {
  it('changes severity via the select and refetches', async () => {
    mockLoad();
    mockPatch.mockResolvedValue({ data: { success: true } });
    renderDetail();
    const select = await screen.findByRole('combobox', { name: 'Change case severity' });
    fireEvent.change(select, { target: { value: 'critical' } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith(
      '/cases/7', null, { params: { severity: 'critical' } },
    ));
  });

  it('does not patch when the same severity is reselected', async () => {
    mockLoad();
    renderDetail();
    const select = await screen.findByRole('combobox', { name: 'Change case severity' });
    fireEvent.change(select, { target: { value: 'high' } });
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe('Case detail editing', () => {
  it('patches title and summary from the edit dialog', async () => {
    mockLoad();
    mockPatch.mockResolvedValue({ data: { success: true } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit case details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit case details' });
    const titleInput = dialog.querySelector('#edit-case-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Suspicious lateral movement');
    fireEvent.change(titleInput, { target: { value: 'Credential theft campaign' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith(
      '/cases/7', null, { params: { title: 'Credential theft campaign', summary: 'Correlated brute force and discovery activity' } },
    ));
  });

  it('keeps the Save button disabled for a blank title', async () => {
    mockLoad();
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit case details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit case details' });
    fireEvent.change(dialog.querySelector('#edit-case-title') as HTMLInputElement, { target: { value: '  ' } });
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe('Case assignment', () => {
  function mockLoadWithMembers() {
    mockLoad();
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url: string) => {
      if (url === '/orgs/me/members') {
        return Promise.resolve({ data: [
          { id: 1, email: 'analyst@example.com', full_name: 'Analyst One', is_active: true },
          { id: 2, email: 'soc-lead@example.com', full_name: 'Sam Oclead', is_active: true },
          { id: 3, email: 'idle@example.com', full_name: null, is_active: false },
        ] });
      }
      return base(url);
    });
  }

  it('assigns the case to an active org member', async () => {
    mockLoadWithMembers();
    mockPost.mockResolvedValue({ data: { success: true, assigned_to_id: 2, assigned_to_email: 'soc-lead@example.com' } });
    renderDetail();
    const select = await screen.findByLabelText('Assign case');
    expect(within(select as HTMLElement).queryByText(/idle@example.com/)).toBeNull();
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/assign', { user_id: 2 }));
  });

  it('unassigns with the empty option', async () => {
    mockLoadWithMembers();
    mockPost.mockResolvedValue({ data: { success: true, assigned_to_id: null, assigned_to_email: null } });
    renderDetail();
    const select = await screen.findByLabelText('Assign case');
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/assign', { user_id: null }));
  });

  it('shows an error toast when assignment fails', async () => {
    mockLoadWithMembers();
    mockPost.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { detail: 'Assignee must be an active member of your organization' } } });
    renderDetail();
    const select = await screen.findByLabelText('Assign case');
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
  });
});

describe('Deleting timeline notes', () => {
  const noteEntry = { id: 21, entry_type: 'note', content: 'Note to remove', source: 'human', timestamp: '2026-11-17T09:00:00Z', metadata_json: null };
  const actionEntry = { id: 22, entry_type: 'action', content: 'Containment ran', source: 'agent', timestamp: '2026-11-17T09:05:00Z', metadata_json: null };

  it('offers delete only on note entries and deletes after confirmation', async () => {
    mockLoadWithTimeline([noteEntry, actionEntry]);
    mockDelete.mockResolvedValue({ data: null });
    renderDetail();
    await screen.findByText('Note to remove');
    expect(screen.getAllByRole('button', { name: 'Delete note' }).length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete note?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/7/notes/21'));
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
  });

  it('cancel keeps the note', async () => {
    mockLoadWithTimeline([noteEntry]);
    renderDetail();
    await screen.findByText('Note to remove');
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Note to remove')).toBeTruthy();
  });
});

describe('Deleting the case', () => {
  function renderWithList() {
    return render(
      <MemoryRouter initialEntries={['/cases/7']}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetail />} />
          <Route path="/cases" element={<div>Cases list</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('deletes the case after confirmation and returns to the list', async () => {
    mockLoad();
    mockDelete.mockResolvedValue({ data: null });
    renderWithList();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete case' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Its timeline, notes, linked alerts and events/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete case' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/7'));
    await screen.findByText('Cases list');
  });

  it('cancel keeps the case', async () => {
    mockLoad();
    renderWithList();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete case' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(await screen.findByText('Suspicious lateral movement')).toBeTruthy();
  });
});

describe('Timeline CSV export', () => {
  it('downloads the timeline CSV', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:timeline');
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
    mockLoad();
    mockGet.mockImplementation(url => {
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url === '/cases/7/export') return Promise.resolve({ data: new Blob(['case_id\n7']) });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: blastRadius } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: similarCases } });
      return Promise.resolve({ data: { ...caseData } });
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/7/export', { responseType: 'blob' }));
    await waitFor(() => expect(clicks).toContain('case-7-timeline.csv'));
  });
});

describe('Case response plans', () => {
  it('lists response plans for the case with status and action count', async () => {
    mockLoadWithPlans([
      { id: 21, status: 'pending_approval', autonomy_level: 'L2', created_by: 'agent', created_at: '2026-11-18T08:00:00Z', actions: [{}, {}] },
      { id: 20, status: 'completed', autonomy_level: 'L1', created_by: 'agent', created_at: '2026-11-17T08:00:00Z', actions: [{}] },
    ]);
    renderDetail();
    expect(await screen.findByText('Response Plans')).toBeTruthy();
    expect((await screen.findByText('Plan #21')).closest('a')?.getAttribute('href')).toBe('/response-plans?plan=21');
    expect(screen.getAllByText('pending approval').some(node => node.tagName === 'SPAN')).toBe(true);
    expect(screen.getByText(/2 actions · L2 · agent/)).toBeTruthy();
    expect(screen.getByText('Plan #20')).toBeTruthy();
  });

  it('shows an explicit empty response plan page when the case has no plans', async () => {
    mockLoadWithPlans([]);
    renderDetail();
    await screen.findByText(caseData.title);
    expect(await screen.findByText('No response plans match this investigation and status filter.')).toBeTruthy();
  });
});

describe('Assignee view', () => {
  const member = {
    id: 42, email: 'member@example.com', full_name: 'Member', company: 'Acme',
    role: 'analyst', is_active: true, is_verified: true, mfa_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('hides owner-only controls but keeps status and notes', async () => {
    useAuthStore.setState({ user: member });
    mockLoad();
    renderDetail();
    expect(await screen.findByText('Suspicious lateral movement')).toBeTruthy();

    // Owner-only controls are gone.
    expect(screen.queryByLabelText('Edit case details')).toBeNull();
    expect(screen.queryByLabelText('Delete case')).toBeNull();
    expect(screen.queryByLabelText('Change case severity')).toBeNull();
    expect(screen.queryByLabelText('Assign case')).toBeNull();
    expect(screen.queryByLabelText('Case due date')).toBeNull();
    expect(screen.queryByRole('button', { name: /link alert/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /link event/i })).toBeNull();

    // Status actions and the note composer stay available.
    expect(screen.getByRole('button', { name: 'Start investigating' })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Add an investigation note/)).toBeTruthy();
  });

  it('lets the assignee move the status', async () => {
    useAuthStore.setState({ user: member });
    mockLoad();
    mockPatch.mockResolvedValue({ data: {} });
    renderDetail();
    expect(await screen.findByText('Suspicious lateral movement')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start investigating' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith(
      '/cases/7', null, { params: { status_update: 'investigating' } }
    ));
  });

  it('shows owner controls to the owner', async () => {
    useAuthStore.setState({ user: { ...member, id: 5, email: 'owner@example.com', full_name: 'Owner' } });
    mockLoad();
    renderDetail();
    expect(await screen.findByText('Suspicious lateral movement')).toBeTruthy();
    expect(screen.getByLabelText('Edit case details')).toBeTruthy();
    expect(screen.getByLabelText('Delete case')).toBeTruthy();
  });
});

describe('Case watchers', () => {
  const members = [
    { id: 5, email: 'owner@example.com', full_name: 'Olga Owner', is_active: true },
    { id: 6, email: 'watcher@example.com', full_name: 'Will Watch', is_active: true },
    { id: 8, email: 'other@example.com', full_name: 'Olive Other', is_active: true },
  ];
  const fullUser = { id: 5, email: 'owner@example.com', full_name: 'Olga Owner', company: 'Acme', role: 'admin', is_active: true, is_verified: true, mfa_enabled: false, created_at: '2026-01-01T00:00:00Z' };

  function mockLoadWithWatchers(watchers: Array<{ user_id: number; email: string; full_name: string | null }>) {
    mockGet.mockImplementation(url => {
      if (url === '/orgs/me/members') return Promise.resolve({ data: members });
      if (url.endsWith('/watchers')) return Promise.resolve({ data: watchers });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
  }

  it('lists watchers and lets the owner add one from the member select', async () => {
    useAuthStore.setState({ user: fullUser });
    mockLoadWithWatchers([{ user_id: 6, email: 'watcher@example.com', full_name: 'Will Watch' }]);
    mockPost.mockResolvedValue({
      data: [
        { user_id: 6, email: 'watcher@example.com', full_name: 'Will Watch' },
        { user_id: 8, email: 'other@example.com', full_name: 'Olive Other' },
      ],
    });
    renderDetail();
    expect(await screen.findByText('Will Watch')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Add a watcher' }), { target: { value: '8' } });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/watchers', { user_id: 8 }));
    expect(await screen.findByText('Olive Other')).toBeTruthy();
  });

  it('toggles watching on and off for the current user', async () => {
    useAuthStore.setState({ user: fullUser });
    let watchers: Array<{ user_id: number; email: string; full_name: string | null }> = [];
    mockGet.mockImplementation(url => {
      if (url === '/orgs/me/members') return Promise.resolve({ data: members });
      if (url.endsWith('/watchers')) return Promise.resolve({ data: watchers });
      if (url.endsWith('/alerts') || url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
    mockPost.mockImplementation(url => {
      if (url.endsWith('/watch')) {
        watchers = [{ user_id: 5, email: 'owner@example.com', full_name: 'Olga Owner' }];
      }
      return Promise.resolve({ data: { success: true } });
    });
    mockDelete.mockImplementation(url => {
      if (url.endsWith('/watch')) watchers = [];
      return Promise.resolve({ data: { success: true } });
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Watch this case' }));
    expect(await screen.findByRole('button', { name: 'Stop watching this case' })).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/cases/7/watch');
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching this case' }));
    expect(await screen.findByRole('button', { name: 'Watch this case' })).toBeTruthy();
    expect(mockDelete).toHaveBeenCalledWith('/cases/7/watch');
  });

  it('lets a watcher remove themselves but hides the add-watcher select from non-owners', async () => {
    useAuthStore.setState({ user: { ...fullUser, id: 6, email: 'watcher@example.com' } });
    mockLoadWithWatchers([{ user_id: 6, email: 'watcher@example.com', full_name: 'Will Watch' }]);
    mockDelete.mockResolvedValue({ data: { success: true } });
    renderDetail();
    expect(await screen.findByText('Will Watch')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Add a watcher' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove watcher watcher@example.com' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/7/watchers/6'));
  });
});

describe('Investigation tasks', () => {
  const tasks = [
    { id: 1, title: 'Contain the host', done: true, position: 0, created_at: '2026-11-18T09:00:00Z', completed_at: '2026-11-18T10:00:00Z' },
    { id: 2, title: 'Collect triage image', done: false, position: 1, created_at: '2026-11-18T09:05:00Z', completed_at: null },
  ];

  function mockLoadWithTasks(initial: Array<Record<string, unknown>>) {
    mockGet.mockImplementation(url => {
      if (url.endsWith('/tasks')) return Promise.resolve({ data: initial });
      if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url.endsWith('/alerts') || url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
  }

  it('lists checklist tasks with a progress summary', async () => {
    mockLoadWithTasks(tasks);
    renderDetail();
    expect(await screen.findByText('Investigation Tasks')).toBeTruthy();
    expect(screen.getByText('Contain the host')).toBeTruthy();
    expect(screen.getByText('Collect triage image')).toBeTruthy();
    expect(screen.getByText('1 of 2 done')).toBeTruthy();
  });

  it('completes an open task from the checklist', async () => {
    mockLoadWithTasks(tasks);
    mockPatch.mockResolvedValue({ data: { ...tasks[1], done: true } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Complete task Collect triage image' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/2', { done: true }));
  });

  it('reopens a completed task from the checklist', async () => {
    mockLoadWithTasks(tasks);
    mockPatch.mockResolvedValue({ data: { ...tasks[0], done: false } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen task Contain the host' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/1', { done: false }));
  });

  it('adds a new task from the input', async () => {
    mockLoadWithTasks([]);
    mockPost.mockResolvedValue({ data: { id: 3, title: 'Eradiate persistence', done: false, position: 0 } });
    renderDetail();
    fireEvent.change(await screen.findByLabelText('New task title'), { target: { value: 'Eradicate persistence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/tasks', { title: 'Eradicate persistence' }));
  });

  it('removes a task from the checklist', async () => {
    mockLoadWithTasks(tasks);
    mockDelete.mockResolvedValue({ data: { success: true } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete task Contain the host' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/7/tasks/1'));
  });

  it('assigns a task to an org member', async () => {
    mockLoadWithTasks(tasks);
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url: string) => {
      if (url === '/orgs/me/members') {
        return Promise.resolve({ data: [
          { id: 2, email: 'soc-lead@example.com', full_name: 'Sam Oclead', is_active: true },
        ] });
      }
      return base(url);
    });
    mockPatch.mockResolvedValue({ data: { ...tasks[1], assignee_id: 2 } });
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Assign task Collect triage image'), { target: { value: '2' } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/2', { assignee_id: 2 }));
  });

  it('unassigns a task back to nobody', async () => {
    mockLoadWithTasks([{ ...tasks[1], assignee_id: 2 }]);
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url: string) => {
      if (url === '/orgs/me/members') {
        return Promise.resolve({ data: [
          { id: 2, email: 'soc-lead@example.com', full_name: 'Sam Oclead', is_active: true },
        ] });
      }
      return base(url);
    });
    mockPatch.mockResolvedValue({ data: { ...tasks[1], assignee_id: null } });
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Assign task Collect triage image'), { target: { value: '' } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/2', { assignee_id: null }));
  });

  it('sets a due date on a task', async () => {
    mockLoadWithTasks(tasks);
    mockPatch.mockResolvedValue({ data: { ...tasks[1], due_date: '2026-12-01' } });
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Due date for task Collect triage image'), { target: { value: '2026-12-01' } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/2', { due_date: '2026-12-01' }));
  });

  it('clears a task due date back to none', async () => {
    mockLoadWithTasks([{ ...tasks[1], due_date: '2026-12-01' }]);
    mockPatch.mockResolvedValue({ data: { ...tasks[1], due_date: null } });
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Due date for task Collect triage image'), { target: { value: '' } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/2', { due_date: null }));
  });

  it('badges an open task past its due date as overdue', async () => {
    mockLoadWithTasks([
      { ...tasks[1], due_date: '2000-01-01' },
      { id: 3, title: 'Future work', done: false, position: 2, created_at: '2026-11-18T09:06:00Z', completed_at: null, due_date: '2999-01-01' },
    ]);
    renderDetail();
    expect(await screen.findByText('Overdue · due 2000-01-01')).toBeTruthy();
    expect(screen.getByText('due 2999-01-01')).toBeTruthy();
  });

  it('does not badge completed tasks as overdue', async () => {
    mockLoadWithTasks([{ ...tasks[0], due_date: '2000-01-01' }]);
    renderDetail();
    expect(await screen.findByText('Contain the host')).toBeTruthy();
    expect(screen.queryByText(/^Overdue · due/)).toBeNull();
  });

  it.each(['rejected', 'malformed'])('does not report an unavailable checklist as empty (%s)', async failure => {
    mockLoadWithTasks([]);
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url, config) => url.endsWith('/tasks')
      ? failure === 'rejected' ? Promise.reject(new Error('Offline')) : Promise.resolve({ data: { unexpected: true } })
      : base(url, config));
    renderDetail();
    expect(await screen.findByText(/Checklist could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/No tasks yet/)).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Task progress' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'New task title' }) as HTMLInputElement).disabled).toBe(true);
    mockLoadWithTasks(tasks);
    fireEvent.click(screen.getByRole('button', { name: 'Retry checklist' }));
    expect(await screen.findByText('Collect triage image')).toBeTruthy();
    expect(screen.queryByText(/Checklist could not be loaded/)).toBeNull();
    expect((screen.getByRole('textbox', { name: 'New task title' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('edits task wording without changing ownership, due date or completion', async () => {
    const task = { ...tasks[1], assignee_id: 5, due_date: '2026-12-01' };
    mockLoadWithTasks([task]);
    mockPatch.mockResolvedValue({ data: { ...task, title: 'Collect memory image' } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit task Collect triage image' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Collect memory image' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task title' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/2', { title: 'Collect memory image' }));
    expect(await screen.findByText('Collect memory image')).toBeTruthy();
    expect((screen.getByLabelText('Due date for task Collect memory image') as HTMLInputElement).value).toBe('2026-12-01');
    expect(screen.getByRole('button', { name: 'Complete task Collect memory image' })).toBeTruthy();
  });

  it('shows the empty state when the checklist is empty', async () => {
    mockLoadWithTasks([]);
    renderDetail();
    expect(await screen.findByText(/No tasks yet/)).toBeTruthy();
  });
});

describe('Seed checklist from a response plan', () => {
  it('posts to the seed endpoint and refreshes', async () => {
    mockLoadWithPlans([{ id: 42, status: 'approved', autonomy_level: 'L1', created_by: 'agent', created_at: '2026-11-18T08:00:00Z', actions: [{ action_type: 'block_ip', target: '10.0.4.9' }] }]);
    const originalGet = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((...args) => String(args[0]).endsWith('/preview') ? Promise.resolve({ data: { case_id: 7, plan_id: 42, plan_status: 'approved', review_fingerprint: 'a'.repeat(64), proposals: [{ action_index: 0, title: 'block_ip: 10.0.4.9', reason: null, priority: null, available: true, already_present: false }] } }) : originalGet(...args));
    mockPost.mockResolvedValue({ data: { created: [{ id: 9, title: 'block_ip: 10.0.4.9', done: false, position: 0 }], skipped: 0 } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Seed checklist from plan 42' }));
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByLabelText('Select action 1 for checklist'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 selected task' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/7/tasks/from-plan/42', { reviewed_fingerprint: 'a'.repeat(64), action_indexes: [0] }));
  });

  it('hides the seed button for plans without actions', async () => {
    mockLoadWithPlans([{ id: 43, status: 'draft', autonomy_level: 'L1', created_by: 'agent', created_at: '2026-11-18T08:00:00Z', actions: [] }]);
    renderDetail();
    expect(await screen.findByText('Plan #43')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seed checklist from plan 43' })).toBeNull();
  });
});

describe('Case close-out', () => {
  function mockClosed(overrides: Record<string, unknown> = {}) {
    mockGet.mockImplementation(url => {
      if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({
        data: {
          ...caseData,
          status: 'closed',
          closed_at: '2026-11-18T08:00:00Z',
          resolution: 'Contained and re-imaged.',
          due_date: '2026-11-19',
          ...overrides,
        },
      });
    });
  }

  it('shows the close-out panel with resolution, timing and SLA result', async () => {
    mockClosed();
    renderDetail();
    expect(await screen.findByTestId('case-closeout')).toBeTruthy();
    expect(screen.getByText('Contained and re-imaged.')).toBeTruthy();
    expect(screen.getByText('Took 2 days')).toBeTruthy();
    expect(screen.getByText('SLA met')).toBeTruthy();
  });

  it('marks the SLA breached when the case closed after its due date', async () => {
    mockClosed({ due_date: '2026-11-17' });
    renderDetail();
    expect(await screen.findByTestId('case-closeout')).toBeTruthy();
    expect(screen.getByText('SLA breached')).toBeTruthy();
  });

  it('shows the empty state when no resolution was recorded', async () => {
    mockClosed({ resolution: null });
    renderDetail();
    expect(await screen.findByTestId('case-closeout')).toBeTruthy();
    expect(screen.getByText('No resolution recorded.')).toBeTruthy();
  });

  it('records a resolution from the close confirmation dialog', async () => {
    mockLoad();
    mockPatch.mockResolvedValue({ data: { success: true } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/Resolution summary/), {
      target: { value: 'False positive, tuning rule added.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7', null, {
      params: { status_update: 'resolved', resolution: 'False positive, tuning rule added.', reviewed_fingerprint: 'a'.repeat(64) },
    }));
  });

  it('lets the owner edit the resolution from the close-out panel', async () => {
    mockClosed();
    mockPatch.mockResolvedValue({ data: { success: true } });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit resolution' }));
    fireEvent.change(screen.getByLabelText('Resolution summary'), {
      target: { value: 'Updated close-out notes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save resolution' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7', null, {
      params: { resolution: 'Updated close-out notes.' },
    }));
  });

  it('hides the close-out panel while the case is open', async () => {
    mockLoad();
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    expect(screen.queryByTestId('case-closeout')).toBeNull();
  });
});

it('does not let a slower investigation overwrite a newly navigated investigation', async () => {
  let finish!: (value: unknown) => void;
  mockGet.mockImplementation(async url => {
    if (url === '/cases/7') return new Promise(resolve => { finish = resolve; });
    if (url === '/cases/8') return { data: { ...caseData, id: 8, title: 'Newly selected investigation' } };
    if (url === '/response-plans/') return { data: { data: [], total: 0 } };
    if (url.endsWith('/blast-radius')) return { data: { success: true, data: null } };
    return { data: [] };
  });
  render(<MemoryRouter initialEntries={['/cases/7']}><Link to="/cases/8">Open other investigation</Link><Routes><Route path="/cases/:caseId" element={<CaseDetail />} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: 'Open other investigation' }));
  await screen.findByText('Newly selected investigation');
  await act(async () => finish({ data: caseData }));
  expect(screen.queryByText(caseData.title)).toBeNull();
  expect(screen.getByText('Newly selected investigation')).toBeTruthy();
});
it('does not show a mismatched investigation response with plan or checklist actions', async () => {
  mockLoad(); mockGet.mockImplementation(async url => url === '/cases/7' ? { data: { ...caseData, id: 99 } } : { data: [] });
  renderDetail(); await screen.findByText('The investigation response did not match the requested record. Retry to load it.');
  expect(screen.queryByRole('region', { name: 'Investigation response plan explorer' })).toBeNull();
});

it('focuses an exact task from a deep link without changing it', async () => {
  mockLoadWithPlans([]);
  const original = mockGet.getMockImplementation()!;
  mockGet.mockImplementation((...args) => String(args[0]).endsWith('/tasks') ? Promise.resolve({ data: Array.from({ length: 23 }, (_, index) => ({ id: index + 1, title: `Deep-linked task ${index + 1}`, done: false, position: index, assignee_id: null, due_date: null })) }) : original(...args));
  renderDetail('/cases/7?task=23');
  await screen.findByText('Deep-linked task 23');
  await waitFor(() => expect(document.activeElement?.id).toBe('case-task-23'));
  expect(screen.getByText('Deep-linked task 23').closest('li')?.className).toContain('ring-primary-400');
  expect(mockPatch).not.toHaveBeenCalled(); expect(mockPost).not.toHaveBeenCalled();
});
it.each(['0', '-1', '07', '9007199254740992', '1&task=2'])('rejects invalid or ambiguous task deep link %s', async id => {
  mockLoadWithPlans([]); renderDetail(`/cases/7?task=${id}`);
  await screen.findByText('The task link has an invalid task ID. No task was selected or changed.');
  expect(mockPatch).not.toHaveBeenCalled(); expect(mockPost).not.toHaveBeenCalled();
});

it('keeps independent checklist batch locks when navigating between investigations with saves in flight', async () => {
  const task = (caseId: number) => ({ id: caseId === 7 ? 1 : 2, case_id: caseId, title: caseId === 7 ? 'Seventh task' : 'Eighth task', done: false, position: 0, assignee_id: null, due_date: null, created_at: '2026-11-20T18:00:00Z', completed_at: null });
  mockGet.mockImplementation(async url => {
    if (/^\/cases\/[78]$/.test(url)) { const id = Number(url.split('/').at(-1)); return { data: { ...caseData, id, title: `Investigation ${id}` } }; }
    if (/^\/cases\/[78]\/tasks$/.test(url)) return { data: [task(Number(url.split('/')[2]))] };
    if (url === '/response-plans/') return { data: { data: [], total: 0 } };
    return { data: [] };
  });
  const finish: Record<number, (value: unknown) => void> = {};
  mockPatch.mockImplementation(url => new Promise(resolve => { finish[Number(url.split('/')[2])] = resolve; }));
  render(<MemoryRouter initialEntries={['/cases/7']}><Link to="/cases/8">Open eighth investigation</Link><Routes><Route path="/cases/:caseId" element={<CaseDetail />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('Select checklist task #1: Seventh task'));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected checklist change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' }));
  fireEvent.click(screen.getByRole('link', { name: 'Open eighth investigation' }));
  fireEvent.click(await screen.findByLabelText('Select checklist task #2: Eighth task'));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected checklist change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 reviewed tasks' }));
  await act(async () => finish[7]({ data: { ...task(7), done: true } }));
  expect((screen.getByLabelText('Due date for task Eighth task') as HTMLInputElement).disabled).toBe(true);
  await act(async () => finish[8]({ data: { ...task(8), done: true } }));
  await screen.findByText(/Confirmed changes for 1 of 1 reviewed tasks/);
  expect((screen.getByLabelText('Due date for task Eighth task') as HTMLInputElement).disabled).toBe(false);
  expect(screen.queryByText('Seventh task')).toBeNull();
  expect(screen.getByText('Investigation 8')).toBeTruthy();
});

describe('Checklist permissions', () => {
  const user = { id: 42, email: 'worker@example.com', full_name: 'Worker', company: 'Acme', role: 'analyst', is_active: true, is_verified: true, mfa_enabled: false, created_at: '2026-01-01T00:00:00Z' };
  const mine = { id: 101, title: 'Work assigned to me', done: false, position: 0, assignee_id: 42, due_date: null, created_at: '2026-11-20T00:00:00Z', completed_at: null };
  const other = { ...mine, id: 102, title: 'Other analyst work', assignee_id: 9, position: 1 };
  function load(assignedTo: number | null = null) {
    mockGet.mockImplementation(async url => {
      if (url.endsWith('/tasks')) return { data: [mine, other] };
      if (url === '/orgs/me/members') return { data: [user, { ...user, id: 9, email: 'other@example.com' }] };
      if (url.endsWith('/watchers') || url.endsWith('/alerts') || url.endsWith('/events')) return { data: [] };
      if (url.endsWith('/blast-radius')) return { data: { success: true, data: null } };
      if (url.endsWith('/similar')) return { data: { success: true, data: [] } };
      return { data: { ...caseData, assigned_to_id: assignedTo } };
    });
  }
  it('keeps watcher evidence readable but management and unassigned task controls disabled', async () => {
    useAuthStore.setState({ user: { ...user, id: 55 } }); load(); renderDetail(); await screen.findByText(mine.title);
    expect(screen.getByRole('button', { name: `Complete task ${mine.title}` })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: `Edit task ${mine.title}` })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: `Delete task ${mine.title}` })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText(`Assign task ${mine.title}`)).toHaveProperty('disabled', true);
    expect(screen.getByLabelText(`Due date for task ${mine.title}`)).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('New task title')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('region', { name: 'Review selected checklist changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Complete task ${mine.title}` })); expect(mockPatch).not.toHaveBeenCalled();
  });
  it('lets a task assignee change only their own completion and due date, not checklist management', async () => {
    useAuthStore.setState({ user }); load(); mockPatch.mockResolvedValue({ data: mine }); renderDetail(); await screen.findByText(mine.title);
    expect(screen.getByRole('button', { name: `Complete task ${mine.title}` })).toHaveProperty('disabled', false);
    expect(screen.getByLabelText(`Due date for task ${mine.title}`)).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: `Complete task ${other.title}` })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText(`Due date for task ${other.title}`)).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: `Edit task ${mine.title}` })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText(`Assign task ${mine.title}`)).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: `Complete task ${mine.title}` })); await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7/tasks/101', { done: true }));
  });
  it('preserves full checklist management for the investigation assignee', async () => {
    useAuthStore.setState({ user }); load(42); renderDetail(); await screen.findByText(mine.title);
    expect(screen.getByRole('button', { name: `Edit task ${other.title}` })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: `Delete task ${other.title}` })).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('New task title')).toHaveProperty('disabled', false);
    expect(screen.getByRole('region', { name: 'Review selected checklist changes' })).toBeTruthy();
  });
  it('does not infer checklist edit rights while the current user is unknown', async () => {
    useAuthStore.setState({ user: null }); load(); renderDetail(); await screen.findByText(mine.title);
    expect(screen.getByRole('button', { name: `Complete task ${mine.title}` })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('New task title')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('region', { name: 'Review selected checklist changes' })).toBeNull();
  });
});
it('links the visible investigation to explicit alert and event evidence explorers', async () => {
  mockLoad(); renderDetail();
  expect((await screen.findByRole('link', { name: 'Browse linked alert evidence' })).getAttribute('href')).toBe('/app/cases/7/evidence?kind=alert');
  expect(screen.getByRole('link', { name: 'Browse linked event evidence' }).getAttribute('href')).toBe('/app/cases/7/evidence?kind=event');
});

it('explains lexical ranking separately from recorded shared technique evidence', async () => {
  mockLoad();
  const original = mockGet.getMockImplementation()!;
  mockGet.mockImplementation(url => url.endsWith('/similar') ? Promise.resolve({ data: { data: [{
    case_id: 4, title: 'Prior gateway case', similarity: 0.73, shared_techniques: ['T1059'],
    ranking_method: 'lexical_tfidf_cosine', shared_terms: ['gateway', 'shell'],
  }] } }) : original(url));
  renderDetail();
  expect(await screen.findByText('Top shared ranking terms: gateway, shell')).toBeTruthy();
  expect(screen.getByText(/not a probability, confirmed relationship or incident match/)).toBeTruthy();
  expect(screen.getByText('Shared techniques: T1059')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Prior gateway case/ }).getAttribute('href')).toBe('/cases/4');
});

 it('offers an ID-only router-relative hunt handoff without leaking case text or starting a hunt', async () => {
  mockLoad(); renderDetail(); const link = await screen.findByRole('link', { name: 'Prepare a hunt hypothesis from this investigation' });
  expect(link.getAttribute('href')).toBe('/hunt?source_case=7'); expect(mockPost).not.toHaveBeenCalled();
 });


describe('Loaded analyst source reference index', () => {
  const metadata = { kind: 'reviewed_evidence_note', schema_version: 1, case_id: 7, record_kind: 'event', record_id: 21, record_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), record_snapshot: { label_at_review: 'Saved indexed source label', label_truncated: false, severity: 'high', recorded_at: null, processing_label: 'in_case' } };
  const note = { id: 99, timestamp: '2026-11-22T12:00:00Z', entry_type: 'note', source: 'human', content: 'Indexed interpretation to locate', author_email: 'owner@example.com', metadata_json: metadata };
  it.each([5, 9, null])('finds and pins the exact note outside timeline filters without source reads or writes for user %s', async userId => {
    const owner = useAuthStore.getState().user!;
    useAuthStore.setState({ user: userId === null ? null : { ...owner, id: userId } });
    mockLoadWithTimeline([note]); renderDetail('/cases/7?task=71');
    await screen.findByText(note.content);
    const index = screen.getByRole('region', { name: 'Analyst source reference index' });
    expect(within(index).queryByRole('list')).toBeNull();
    fireEvent.change(screen.getByLabelText('Find timeline evidence'), { target: { value: 'not matching any timeline entry' } });
    expect(screen.queryByText(note.content)).toBeNull();
    const before = mockGet.mock.calls.length;
    fireEvent.click(within(index).getByRole('button', { name: 'Explore saved source notes' }));
    expect(within(index).getByText(note.content)).toBeTruthy();
    fireEvent.click(within(index).getByRole('button', { name: 'Show note #99 in timeline' }));
    await waitFor(() => expect(document.getElementById('case-note-99')).toBeTruthy());
    expect(screen.getByText(/1 linked or edited entry is kept visible/)).toBeTruthy();
    expect(document.getElementById('case-note-99')!.className).toContain('ring-2');
    expect(mockGet.mock.calls.length).toBe(before);
    expect(mockGet.mock.calls.some(([url]) => url.includes('/source-comparison'))).toBe(false);
    expect(within(index).queryByRole('link')).toBeNull();
    expect(mockPost).not.toHaveBeenCalled(); expect(mockPatch).not.toHaveBeenCalled(); expect(mockDelete).not.toHaveBeenCalled();
  });
});
