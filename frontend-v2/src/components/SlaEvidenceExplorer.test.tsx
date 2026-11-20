import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SlaEvidenceExplorer } from './SlaEvidenceExplorer';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const record = { id: 12, title: 'Legacy closure', status: 'closed', severity: 'high', due_date: '2026-11-19', completed_on: null, outcome: 'unknown', reason: 'Completion time was not recorded; timing cannot be scored.' };
const page = { kind: 'cases', days: 30, window_start: '2026-10-22', window_end: '2026-11-20', generated_at: '2026-11-20T14:00:00Z', total: 1, offset: 0, records: [record] };
const renderExplorer = () => render(<MemoryRouter><SlaEvidenceExplorer kind="cases" days={30} /></MemoryRouter>);
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('SLA record evidence', () => {
  it('shows recorded completion, outcome and safe investigation link without inferring a score', async () => {
    get.mockResolvedValue({ data: page });
    renderExplorer();
    expect(await screen.findByText('#12: Legacy closure')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
    expect(screen.getByText(/Recorded completion: not recorded/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open investigation #12' }).getAttribute('href')).toBe('/cases/12');
    expect(screen.getByText(/Filters do not change the summary/)).toBeTruthy();
  });

  it('clears stale evidence and retries the same filter after a failure', async () => {
    get.mockResolvedValueOnce({ data: page }).mockRejectedValueOnce(new Error('Evidence service failed')).mockResolvedValueOnce({ data: { ...page, records: [] } });
    renderExplorer();
    await screen.findByText('#12: Legacy closure');
    fireEvent.change(screen.getByLabelText('SLA outcome'), { target: { value: 'breached' } });
    await screen.findByRole('alert');
    expect(screen.queryByText('#12: Legacy closure')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry SLA evidence' }));
    await screen.findByText(/No records match this page/);
    expect(get).toHaveBeenLastCalledWith('/reports/sla/records', { params: { kind: 'cases', days: 30, outcome: 'breached', query: '', offset: 0, limit: 20 } });
  });

  it('ignores late responses for previous search filters', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }) as ReturnType<typeof apiClient.get>);
    get.mockResolvedValueOnce({ data: { ...page, total: 0, records: [] } });
    renderExplorer();
    fireEvent.change(screen.getByLabelText('Find SLA records by title, status or ID'), { target: { value: 'new search' } });
    await screen.findByText(/No records match this page/);
    await act(async () => resolveOld({ data: page }));
    expect(screen.queryByText('#12: Legacy closure')).toBeNull();
  });

  it('pages the requested cohort and resets the page when filters change', async () => {
    get.mockResolvedValue({ data: { ...page, total: 21 } });
    renderExplorer();
    await screen.findByText('#12: Legacy closure');
    fireEvent.click(screen.getByRole('button', { name: 'Next evidence page' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/reports/sla/records', { params: expect.objectContaining({ offset: 20 }) }));
    await screen.findByText('#12: Legacy closure');
    fireEvent.change(screen.getByLabelText('SLA outcome'), { target: { value: 'unknown' } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/reports/sla/records', { params: expect.objectContaining({ offset: 0, outcome: 'unknown' }) }));
  });

  it('does not fabricate a record route for alerts', async () => {
    get.mockResolvedValue({ data: { ...page, kind: 'alerts' } });
    render(<MemoryRouter><SlaEvidenceExplorer kind="alerts" days={7} /></MemoryRouter>);
    await screen.findByText('#12: Legacy closure');
    expect(screen.queryByRole('link')).toBeNull();
    expect(get).toHaveBeenCalledWith('/reports/sla/records', { params: expect.objectContaining({ days: 7, kind: 'alerts' }) });
  });
});
