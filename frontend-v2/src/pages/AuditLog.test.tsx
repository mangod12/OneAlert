import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    if (url === '/auth/audit-logs') return { data: { logs, total: logs.length } };
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
      if (url === '/auth/audit-logs') return { data: { logs, total: logs.length } };
      throw new Error('offline');
    });
    render(<AuditLog />);
    await screen.findByText('case.status_changed');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/cases/agents/runs'));
    expect(screen.queryByText('Agent activity')).toBeNull();
  });
});

describe('AuditLog action search and pagination', () => {
  it('sends the action substring to the API', async () => {
    render(<AuditLog />);
    const input = await screen.findByLabelText('Search audit actions');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/audit-logs', { params: { page: 1, size: 50 } }));
    fireEvent.change(input, { target: { value: 'status' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/auth/audit-logs', { params: { page: 1, size: 50, action: 'status' } });
    });
  });

  it('sends user and date range filters to the API', async () => {
    render(<AuditLog />);
    await screen.findByLabelText('Search audit actions');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/audit-logs', { params: { page: 1, size: 50 } }));
    fireEvent.change(screen.getByLabelText('Filter by user email'), { target: { value: 'analyst@' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-11-10' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/auth/audit-logs', { params: {
        page: 1,
        size: 50,
        user: 'analyst@',
        from_date: '2026-11-01T00:00:00',
        to_date: '2026-11-10T23:59:59',
      } });
    });
  });

  it('paginates server-side', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/audit-logs') return { data: { logs, total: 120 } };
      if (url === '/cases/agents/runs') return { data: runs };
      throw new Error(`unexpected ${url}`);
    });
    render(<AuditLog />);
    await screen.findByText('Page 1 of 3');
    expect(screen.getByText('120 entries')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/auth/audit-logs', { params: { page: 2, size: 50 } });
    });
    expect(screen.getByRole('button', { name: 'Prev' })).toHaveProperty('disabled', false);
  });
});

describe('AuditLog CSV export', () => {
  it('downloads the CSV with the current action filter', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:audit');
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
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/audit-logs/export') return { data: new Blob(['id,timestamp\n1,2026-11-17'], { type: 'text/csv' }) };
      if (url === '/auth/audit-logs') return { data: { logs, total: logs.length } };
      if (url === '/cases/agents/runs') return { data: runs };
      throw new Error(`unexpected ${url}`);
    });
    render(<AuditLog />);
    fireEvent.change(await screen.findByLabelText('Search audit actions'), { target: { value: 'case' } });
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/audit-logs/export', { params: { action: 'case' }, responseType: 'blob' }));
    await waitFor(() => expect(clicks).toContain('audit-logs.csv'));
    expect(clicks).toContain('clicked');
  });

  it('shows an inline error when the export fails', async () => {
    render(<AuditLog />);
    await screen.findByLabelText('Search audit actions');
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/audit-logs/export') throw { isAxiosError: true, response: { status: 500, data: {} } };
      if (url === '/auth/audit-logs') return { data: { logs, total: logs.length } };
      if (url === '/cases/agents/runs') return { data: runs };
      throw new Error(`unexpected ${url}`);
    });
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});


describe('Recorded run inspection', () => {
  it('opens read-only detail and closes back to the run list', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/audit-logs') return { data: { logs, total: logs.length } };
      if (url === '/cases/agents/runs') return { data: runs };
      if (url === '/cases/agents/runs/3') return { data: { ...runs[0], error_message: null, steps: [] } };
      throw new Error('Unexpected request');
    });
    render(<AuditLog />);
    const inspect = await screen.findByRole('button', { name: 'Inspect triage run 3' });
    inspect.focus();
    fireEvent.click(inspect);
    await screen.findByText('Recorded steps (0)');
    expect(screen.getByRole('dialog').textContent).toContain('Recorded agent run #3');
    fireEvent.click(screen.getByRole('button', { name: 'Close run' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inspect triage run 3' }));
  });

  it('keeps owner run inspection available when admin audit records are denied', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/audit-logs') throw new Error('Not authorized');
      if (url === '/cases/agents/runs') return { data: runs };
      throw new Error('Unexpected request');
    });
    render(<AuditLog />);
    await screen.findByText('Audit log unavailable');
    expect(screen.getByRole('button', { name: 'Inspect triage run 3' })).toBeTruthy();
  });

  it('shows a ledger failure and retries without reloading the audit records', async () => {
    let failed = true;
    get.mockImplementation(async (url: string) => {
      if (url === '/auth/audit-logs') return { data: { logs, total: logs.length } };
      if (url === '/cases/agents/runs') {
        if (failed) throw new Error('Offline');
        return { data: [] };
      }
      throw new Error('Unexpected request');
    });
    render(<AuditLog />);
    await screen.findByText('Agent activity unavailable');
    expect(screen.queryByText('No agent runs recorded for your account.')).toBeNull();
    expect(screen.getByText('case.status_changed')).toBeTruthy();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await screen.findByText('No agent runs recorded for your account.');
    expect(get.mock.calls.filter(([url]) => url === '/auth/audit-logs')).toHaveLength(1);
  });
});


it('loads the owner ledger independently while admin audit records are pending', async () => {
  get.mockImplementation((url: string) => {
    if (url === '/auth/audit-logs') return new Promise(() => {});
    if (url === '/cases/agents/runs') return Promise.resolve({ data: runs });
    return Promise.reject(new Error('Unexpected request'));
  });
  render(<AuditLog />);
  expect(await screen.findByRole('button', { name: 'Inspect triage run 3' })).toBeTruthy();
  expect(screen.getByText('Loading audit activity')).toBeTruthy();
});


it.each(['success', 'failure'])('ignores stale audit %s after the filter changed', async outcome => {
  let resolveOld!: (value: unknown) => void;
  let rejectOld!: (reason: unknown) => void;
  get.mockImplementation((url, config) => {
    if (url === '/cases/agents/runs') return Promise.resolve({ data: runs });
    const action = (config?.params as { action?: string } | undefined)?.action;
    if (action === 'old') return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    if (action === 'new') return Promise.resolve({ data: { logs: [{ ...logs[0], action: 'new.action' }], total: 1 } });
    return Promise.resolve({ data: { logs, total: logs.length } });
  });
  render(<AuditLog />);
  const input = await screen.findByLabelText('Search audit actions');
  fireEvent.change(input, { target: { value: 'old' } });
  fireEvent.change(input, { target: { value: 'new' } });
  await screen.findByText('new.action');
  await act(async () => {
    if (outcome === 'success') resolveOld({ data: { logs: [{ ...logs[0], action: 'stale.action' }], total: 999 } });
    else rejectOld(new Error('Stale failure'));
  });
  expect(screen.getByText('new.action')).toBeTruthy();
  expect(screen.queryByText('stale.action')).toBeNull();
  expect(screen.queryByText('999 entries')).toBeNull();
  expect(screen.queryByText('Audit log unavailable')).toBeNull();
});
