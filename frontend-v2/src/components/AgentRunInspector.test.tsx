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
