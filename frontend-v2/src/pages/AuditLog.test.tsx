import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AuditLog } from './AuditLog';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(apiClient.get);

const logs = [
  { id: 1, user_id: 1, action: 'case.status_changed', target_type: 'case', target_id: '7', detail: 'open -> investigating', timestamp: '2026-11-17T09:00:00Z' },
];
const runs = [
  { id: 3, agent_type: 'triage', status: 'completed', started_at: '2026-11-17T08:30:00Z', completed_at: '2026-11-17T08:31:00Z', model_used: 'gpt-4o', prompt_tokens: 1200, completion_tokens: 300, result_summary: 'Triaged 4 alerts' },
  { id: 2, agent_type: 'hunt', status: 'failed', started_at: '2026-11-17T07:00:00Z', completed_at: null, model_used: null, prompt_tokens: 0, completion_tokens: 0, result_summary: null },
];

beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/auth/audit-logs') return { data: logs };
    if (url === '/cases/agents/runs') return { data: runs };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AuditLog agent activity', () => {
  it('lists recent agent runs with status, model and token usage', async () => {
    render(<AuditLog />);
    await screen.findByText('Agent activity');
    expect(screen.getByText('triage')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('gpt-4o')).toBeTruthy();
    expect(screen.getByText('1,500')).toBeTruthy();
    expect(screen.getByText('Triaged 4 alerts')).toBeTruthy();
  });

  it('still shows the audit table when the agent ledger is unavailable', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/audit-logs') return { data: logs };
      throw new Error('offline');
    });
    render(<AuditLog />);
    await screen.findByText('case.status_changed');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/cases/agents/runs'));
    expect(screen.queryByText('Agent activity')).toBeNull();
  });
});
