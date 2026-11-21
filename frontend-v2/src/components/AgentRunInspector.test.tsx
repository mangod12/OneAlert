import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AgentRunInspector } from './AgentRunInspector';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const run = {
  id: 3, agent_type: 'triage', status: 'failed', started_at: '2026-11-19T08:00:00Z',
  completed_at: null, model_used: null, prompt_tokens: 30, completion_tokens: 10,
  result_summary: 'Partial recorded result\nSecond line', error_message: 'Recorded model timeout',
  steps: [
    { id: 9, step_number: 2, action: 'correlate', input_summary: null, output_summary: 'One cluster', tool_used: null, duration_ms: null },
    { id: 8, step_number: 1, action: 'analyze', input_summary: 'Three alerts', output_summary: '<b>plain recorded text</b>', tool_used: 'local_detector', duration_ms: 0 },
  ],
};

beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: run }); });
afterEach(cleanup);

describe('AgentRunInspector', () => {
  it('shows owner run evidence and numbered steps without treating summaries as markup', async () => {
    render(<AgentRunInspector runId={3} onClose={vi.fn()} />);
    await screen.findByText('Recorded model timeout');
    expect(get).toHaveBeenCalledWith('/cases/agents/runs/3');
    expect(screen.getByText('30 prompt / 10 completion')).toBeTruthy();
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('1. analyze');
    expect(screen.getAllByRole('listitem')[1].textContent).toContain('2. correlate');
    expect(screen.getByText('<b>plain recorded text</b>').querySelector('b')).toBeNull();
    expect(screen.getByText(/Duration: 0 ms/)).toBeTruthy();
    expect(screen.getByText(/not a full transcript/)).toBeTruthy();
  });

  it('starts with loading and distinguishes missing recorded steps from failure', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<AgentRunInspector runId={3} onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    finish({ data: { ...run, steps: [], result_summary: null, error_message: null } });
    await screen.findByText(/No steps recorded/);
    expect(screen.getByText('No result summary recorded.')).toBeTruthy();
    expect(screen.queryByText('Recorded failure')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries failed detail requests instead of showing an empty ledger', async () => {
    get.mockRejectedValueOnce(new Error('Offline'));
    render(<AgentRunInspector runId={3} onClose={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/No steps recorded/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry run' }));
    await screen.findByText('Recorded model timeout');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rejects detail belonging to another run', async () => {
    get.mockResolvedValue({ data: { ...run, id: 12 } });
    render(<AgentRunInspector runId={3} onClose={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Recorded model timeout')).toBeNull();
  });

  it('ignores an older response after changing runs', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<AgentRunInspector runId={2} onClose={vi.fn()} />);
    rerender(<AgentRunInspector runId={3} onClose={vi.fn()} />);
    await screen.findByText('Recorded model timeout');
    finish({ data: { ...run, id: 2, error_message: 'Stale failure' } });
    await waitFor(() => expect(screen.queryByText('Stale failure')).toBeNull());
    expect(screen.getByText('Recorded model timeout')).toBeTruthy();
  });

  it('supports Escape, Close and focus restoration', async () => {
    const close = vi.fn();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(<AgentRunInspector runId={3} onClose={close} />);
    const button = screen.getByRole('button', { name: 'Close run' });
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(button);
    expect(close).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

const exportPayload = { format: 'onealert-agent-run-evidence', version: 1, exported_at: '2026-11-21T12:00:00Z', step_count: 2, scope: 'Saved summaries only, not proof of success.', run };
function exportBlob(value: unknown) { const blob = new Blob([JSON.stringify(value)], { type: 'application/json' }); Object.defineProperty(blob, 'text', { value: async () => JSON.stringify(value) }); return blob; }
it('downloads a fresh exact run JSON only on request with sensitivity and current-read caveats', async () => {
  const create = vi.fn().mockReturnValue('blob:recorded-run'), revoke = vi.fn(), click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  render(<AgentRunInspector runId={3} onClose={vi.fn()} />); await screen.findByText('Recorded model timeout');
  expect(screen.getByText(/downloaded copies have no application access controls/)).toBeTruthy();
  get.mockResolvedValueOnce({ data: exportBlob(exportPayload) }); fireEvent.click(screen.getByRole('button', { name: 'Download this run evidence (JSON)' }));
  await screen.findByText(/Run evidence download prepared/);
  expect(get).toHaveBeenLastCalledWith('/cases/agents/runs/3/export', { responseType: 'blob' });
  expect(create).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith('blob:recorded-run'); expect(click).toHaveBeenCalledTimes(1);
  click.mockRestore(); vi.unstubAllGlobals();
});
it.each([{ ...exportPayload, run: { ...run, id: 9 } }, { ...exportPayload, step_count: 3 }, { ...exportPayload, version: 2 }, { ...exportPayload, exported_at: 'bad' }])('does not prepare a file for mismatched or incomplete export %j', async payload => {
  const create = vi.fn(); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
  render(<AgentRunInspector runId={3} onClose={vi.fn()} />); await screen.findByText('Recorded model timeout');
  get.mockResolvedValueOnce({ data: exportBlob(payload) }); fireEvent.click(screen.getByRole('button', { name: 'Download this run evidence (JSON)' }));
  await screen.findByRole('alert'); expect(create).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
it('suppresses repeated download clicks and ignores an older run export after the run changes', async () => {
  let finish!: (value: unknown) => void; const create = vi.fn(); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
  const { rerender } = render(<AgentRunInspector runId={3} onClose={vi.fn()} />); await screen.findByText('Recorded model timeout');
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const button = screen.getByRole('button', { name: 'Download this run evidence (JSON)' }); fireEvent.click(button); fireEvent.click(button);
  expect(get.mock.calls.filter(([url]) => String(url).endsWith('/export'))).toHaveLength(1);
  get.mockResolvedValueOnce({ data: { ...run, id: 4 } }); rerender(<AgentRunInspector runId={4} onClose={vi.fn()} />);
  await screen.findByText('Recorded agent run #4'); finish({ data: exportBlob(exportPayload) }); await new Promise(resolve => setTimeout(resolve, 0));
  expect(create).not.toHaveBeenCalled(); expect(screen.queryByText(/Run evidence download prepared/)).toBeNull(); vi.unstubAllGlobals();
});
it('allows retrying an export read failure without rerunning the agent', async () => {
  render(<AgentRunInspector runId={3} onClose={vi.fn()} />); await screen.findByText('Recorded model timeout');
  get.mockRejectedValueOnce(new Error('Offline')); fireEvent.click(screen.getByRole('button', { name: 'Download this run evidence (JSON)' }));
  await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Download this run evidence (JSON)' }).hasAttribute('disabled')).toBe(false);
  expect(get.mock.calls.every(([url]) => String(url).startsWith('/cases/agents/runs/3'))).toBe(true);
});
