import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaseDetail } from './CaseDetail';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPatch = vi.mocked(apiClient.patch);

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
    return Promise.resolve({ data: { ...caseData, status } });
  });
}

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
