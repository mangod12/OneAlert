import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('checkbox', { name: 'Include recorded timeline and notes' })).not.toBeChecked();
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

const planPage = { data: [{ id: 21, case_id: 7, status: 'partial', autonomy_level: 'L1', created_by: 'private-plan-actor', approved_by: 88, created_at: '2026-11-20T00:00:00Z', actions: [{ priority: 0, action_type: 'notify', target: 'soc', reason: 'Recorded reason', execution_result: { status: 'completed', execution_mode: 'simulated', detail: 'Simulation only', executed_at: '2026-11-20T18:00:00+05:30' } }] }], total: 11, page: 1, size: 10 };
function withPlanPage() { loaded(); const base = get.getMockImplementation()!; get.mockImplementation((url, config) => url === '/response-plans/' ? Promise.resolve({ data: planPage }) : base(url, config)); }
const includePlans = async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' })); await screen.findByRole('textbox'); fireEvent.click(screen.getByRole('checkbox', { name: 'Include a loaded page of saved response plan evidence' })); };
it('fetches plan evidence only after opt-in and labels the exported scope', async () => {
  withPlanPage(); render(<CaseHandoff caseId={7} />); await includePlans();
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Plan #21'));
  expect(get).toHaveBeenCalledWith('/response-plans/', { params: { case_id: 7, page: 1, size: 10 } });
  const text = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
  expect(text).toContain('Only this loaded plan page is included'); expect(text).toContain('Simulated, no external action performed'); expect(text).not.toContain('private-plan-actor');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include a loaded page of saved response plan evidence' }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toContain('Plan #21');
});
it('blocks a mismatched plan page without turning it into an empty completed handoff', async () => {
  loaded(); const base = get.getMockImplementation()!;
  get.mockImplementation((url, config) => url === '/response-plans/' ? Promise.resolve({ data: { ...planPage, data: [{ ...planPage.data[0], case_id: 99 }] } }) : base(url, config));
  render(<CaseHandoff caseId={7} />); await includePlans(); await screen.findByText(/response plan page did not match/);
  expect(screen.getByRole('button', { name: 'Download handoff' })).toBeDisabled(); expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toContain('Plan #21');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include a loaded page of saved response plan evidence' })); expect(screen.getByRole('button', { name: 'Download handoff' })).toBeEnabled();
});
it('ignores late plan evidence after opt-out', async () => {
  loaded(); const base = get.getMockImplementation()!; let finish!: (v: unknown) => void;
  get.mockImplementation((url, config) => url === '/response-plans/' ? new Promise(resolve => { finish = resolve; }) : base(url, config));
  render(<CaseHandoff caseId={7} />); await includePlans(); expect(screen.getByRole('button', { name: 'Download handoff' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include a loaded page of saved response plan evidence' })); await act(async () => finish({ data: planPage }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toContain('Plan #21'); expect(screen.getByRole('button', { name: 'Download handoff' })).toBeEnabled();
});
it('exports a newly chosen page only after that page is loaded', async () => {
  withPlanPage(); render(<CaseHandoff caseId={7} />); await includePlans(); await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Plan #21'));
  let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Next handoff plan page' })); expect(screen.getByRole('button', { name: 'Download handoff' })).toBeDisabled();
  await act(async () => finish({ data: { ...planPage, data: [{ ...planPage.data[0], id: 11 }], page: 2 } }));
  const text = (screen.getByRole('textbox') as HTMLTextAreaElement).value; expect(text).toContain('Plan #11'); expect(text).not.toContain('Plan #21'); expect(text).toContain('Plan page: 2 of 2');
});
it('requires a fresh opt-in after closing the handoff review', async () => {
  withPlanPage(); render(<CaseHandoff caseId={7} />); await includePlans(); await waitFor(() => expect(screen.getByRole('button', { name: 'Download handoff' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Close review' })); fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' })); await screen.findByRole('textbox');
  expect(screen.getByRole('checkbox', { name: 'Include a loaded page of saved response plan evidence' })).not.toBeChecked();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toContain('Plan #21');
});
it('blocks an optional plan fetch failure until retry succeeds or the reviewer opts out', async () => {
  loaded(); const base = get.getMockImplementation()!; let fail = true;
  get.mockImplementation((url, config) => url === '/response-plans/' ? fail ? Promise.reject(new Error('Plan evidence unavailable')) : Promise.resolve({ data: planPage }) : base(url, config));
  render(<CaseHandoff caseId={7} />); await includePlans(); await screen.findByText('Plan evidence unavailable');
  expect(screen.getByRole('button', { name: 'Download handoff' })).toBeDisabled(); fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reload handoff plan page' }));
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Plan #21'));
  expect(screen.getByRole('button', { name: 'Download handoff' })).toBeEnabled();
});
