import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostureSnapshotHandoff, type PostureSnapshotInput } from './PostureSnapshotHandoff';
const snapshot: PostureSnapshotInput = { days: 30, receivedAt: '2026-11-20T12:00:00Z', posture: { days: 30, alerts: { opened: 0 } }, sla: null, trend: { series: [] }, workload: { members: [{ email: 'private@example.test', full_name: 'Analyst', alerts_open: 7 }] } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function download() {
  let blob: Blob | undefined;
  vi.stubGlobal('URL', { createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:report'; }), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Download report snapshot JSON' }));
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); }); return JSON.parse(text);
}
describe('Posture snapshot handoff', () => {
  it('preserves unavailable-versus-zero and excludes team details by default', async () => {
    render(<PostureSnapshotHandoff snapshot={snapshot} />); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const body = await download(); expect(body.sections.sla).toMatchObject({ status: 'unavailable', data: null });
    expect(body.sections.posture.data.alerts.opened).toBe(0);
    expect(body.sections.team_workload).toMatchObject({ status: 'excluded_by_export_selection', data: null });
    expect(JSON.stringify(body)).not.toContain('private@example.test');
    expect(body.response_received_at).toBe(snapshot.receivedAt); expect(body.requested_days).toBe(30);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('includes loaded team identities only after the explicit export selection', async () => {
    render(<PostureSnapshotHandoff snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('checkbox'));
    const body = await download(); expect(body.sections.team_workload.status).toBe('recorded'); expect(body.sections.team_workload.data.members[0].email).toBe('private@example.test');
    expect(body.sections.team_workload.time_basis).toContain('not restricted');
  });
  it('does not turn unavailable team data into an excluded but available section', async () => {
    render(<PostureSnapshotHandoff snapshot={{ ...snapshot, workload: null }} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((await download()).sections.team_workload.status).toBe('unavailable');
  });
  it('keeps the report available when export fails', () => {
    render(<PostureSnapshotHandoff snapshot={snapshot} />);
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('denied'); } });
    fireEvent.click(screen.getByRole('button', { name: 'Download report snapshot JSON' }));
    expect(screen.getByRole('alert').textContent).toContain('could not be downloaded');
    expect(screen.getByText(/Missing data will not be exported as zero/)).toBeTruthy();
  });
});
