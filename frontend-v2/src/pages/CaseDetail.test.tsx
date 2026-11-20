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

function mockLoad(status = 'open') {
  mockGet.mockImplementation(url => {
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
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
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
    fireEvent.click(screen.getByRole('button', { name: 'Link alert' }));
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
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url === '/alerts/') return Promise.resolve({ data: { alerts: recentAlerts, total: 2 } });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: recentAlerts });
      if (url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: 'Link alert' }));
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
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
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
    fireEvent.click(screen.getByRole('button', { name: 'Link event' }));
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
    if (url.endsWith('/watchers')) return Promise.resolve({ data: [] });
      if (url === '/events/') return Promise.resolve({ data: { events: recentEvents, total: 2 } });
      if (url.endsWith('/events')) return Promise.resolve({ data: recentEvents });
      if (url.endsWith('/alerts')) return Promise.resolve({ data: [] });
      if (url.endsWith('/blast-radius')) return Promise.resolve({ data: { success: true, data: null } });
      if (url.endsWith('/similar')) return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: caseData });
    });
    renderDetail();
    await screen.findByText('Suspicious lateral movement');
    fireEvent.click(screen.getByRole('button', { name: 'Link event' }));
    expect(await screen.findByText('Every recent event is already linked.')).toBeTruthy();
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

  it('unlinks an alert and refreshes the case', async () => {
    mockLoadWithLinked();
    mockDelete.mockResolvedValue({ data: { success: true, data: { unlinked: true } } });
    renderDetail();
    await screen.findByText('Suspicious login burst');
    fireEvent.click(screen.getByRole('button', { name: 'Unlink alert Suspicious login burst' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/7/alerts/11'));
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
  });

  it('unlinks an event and refreshes the case', async () => {
    mockLoadWithLinked();
    mockDelete.mockResolvedValue({ data: { success: true, data: { unlinked: true } } });
    renderDetail();
    await screen.findByText(/ET SCAN Nmap/);
    fireEvent.click(screen.getByRole('button', { name: 'Unlink event ET SCAN Nmap' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/7/events/21'));
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/7').length).toBe(2));
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
    expect(screen.queryByText(/Overdue/)).toBeNull();
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
    fireEvent.change(within(dialog).getByLabelText(/Resolution summary/), {
      target: { value: 'False positive, tuning rule added.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/cases/7', null, {
      params: { status_update: 'resolved', resolution: 'False positive, tuning rule added.' },
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
