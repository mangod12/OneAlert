import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseHandoff } from './CaseHandoff';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const investigation = { id: 7, title: 'Fresh investigation', status: 'investigating', severity: 'high', summary: 'Recorded summary', assigned_to_email: 'analyst@example.test', due_date: '2026-11-23', timeline: [{ id: 1, timestamp: '2026-11-19T10:00:00Z', entry_type: 'note', source: 'user', content: '<script>private note</script>' }] };
function loaded() {
  get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/tasks') ? [{ id: 2, title: 'Verify endpoint', done: false, assignee_id: 5 }] : url.endsWith('/alerts') ? [{ id: 8, title: 'Remote login', severity: 'high' }] : url.endsWith('/events') ? [{ id: 9, event_type: 'network', severity: 'medium' }] : investigation }));
}
beforeEach(() => { vi.clearAllMocks(); loaded(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('investigation handoff review', () => {
  it('fetches fresh data and keeps timeline private by default', async () => {
    render(<CaseHandoff caseId={7} />);
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }));
    const preview = await screen.findByRole('textbox', { name: 'Handoff preview' });
    expect((preview as HTMLTextAreaElement).value).toContain('Fresh investigation');
    expect((preview as HTMLTextAreaElement).value).toContain('Verify endpoint');
    expect((preview as HTMLTextAreaElement).value).not.toContain('private note');
    expect(get).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include recorded timeline and notes' }));
    expect((preview as HTMLTextAreaElement).value).toContain('<script>private note</script>');
    expect(document.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }));
    await screen.findByRole('textbox');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(get).toHaveBeenCalledTimes(8);
  });

  it.each(['/tasks', '/alerts', '/events', '/cases/7'])('blocks incomplete snapshots when %s fails, with retry', async failed => {
    loaded();
    const base = get.getMockImplementation()!;
    get.mockImplementation((url, config) => url.endsWith(failed) ? Promise.reject(new Error('Offline')) : base(url, config));
    render(<CaseHandoff caseId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Download handoff' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Retry handoff' }));
    await screen.findByRole('textbox');
    expect(screen.getByRole('button', { name: 'Download handoff' })).toBeEnabled();
  });

  it('rejects mismatched case identity', async () => {
    get.mockResolvedValue({ data: { ...investigation, id: 8 } });
    render(<CaseHandoff caseId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Download handoff' })).toBeDisabled();
  });

  it('does not allow downloads while loading and ignores a response after close', async () => {
    let resolve!: (value: { data: unknown }) => void;
    get.mockImplementation(() => new Promise(r => { resolve = r; }));
    render(<CaseHandoff caseId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }));
    expect(screen.getByRole('button', { name: 'Download handoff' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    resolve({ data: [] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('downloads a local plain-text file after review', async () => {
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<CaseHandoff caseId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }));
    await screen.findByRole('textbox');
    fireEvent.click(screen.getByRole('button', { name: 'Download handoff' }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/plain;charset=utf-8' }));
    expect(click.mock.instances[0]).toHaveAttribute('download', 'investigation-7-handoff.txt');
    expect(revoke).toHaveBeenCalledWith('blob:test');
    click.mockRestore();
  });
});
