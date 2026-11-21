import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { OnCallCoverage } from './OnCallCoverage';
vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const coverage = { timezone: 'UTC', from_date: '2026-11-21', until_exclusive: '2027-01-16', retrieved_at: '2026-11-21T08:00:00Z', configured: true, anchor_date: '2026-11-21', active_member_count: 1, coverage: [
  { from_date: '2026-11-21', until_exclusive: '2026-11-28', member_id: 1, member_name: 'Case Analyst', on_call_override_available: true },
  { from_date: '2026-11-28', until_exclusive: '2027-01-16', member_id: null, member_name: null, on_call_override_available: false },
] };
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
describe('Saved on-call coverage', () => {
  it('shows exact UTC periods and inactive-member and assignment limitations', async () => {
    get.mockResolvedValue({ data: coverage }); render(<OnCallCoverage revision="saved" />);
    expect(await screen.findByText(/Case Analyst/)).toBeTruthy();
    expect(screen.getByText(/Scheduled member unavailable/)).toBeTruthy();
    expect(screen.getByText(/Fewer than two active members/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/orgs/me/on-call/coverage');
  });
  it('supports disabled state and explicit refresh', async () => {
    get.mockResolvedValue({ data: { ...coverage, configured: false, coverage: [] } }); render(<OnCallCoverage revision="saved" />);
    expect(await screen.findByText(/No saved rotation/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh coverage preview' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
  it('clears old periods when refreshing fails and allows retry', async () => {
    get.mockResolvedValueOnce({ data: coverage }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: coverage });
    render(<OnCallCoverage revision="saved" />); await screen.findByText(/Case Analyst/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh coverage preview' })); await screen.findByRole('alert');
    expect(screen.queryByText(/Case Analyst/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh coverage preview' })); expect(await screen.findByText(/Case Analyst/)).toBeTruthy();
  });
  it('rejects gaps rather than presenting incomplete coverage', async () => {
    get.mockResolvedValue({ data: { ...coverage, coverage: [coverage.coverage[1]] } }); render(<OnCallCoverage revision="saved" />);
    await screen.findByRole('alert'); expect(screen.queryByText(/Scheduled member unavailable/)).toBeNull();
  });
  it('ignores late reads from an old saved rotation revision', async () => {
    let resolve!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.get>).mockResolvedValue({ data: { ...coverage, configured: false, coverage: [] } });
    const view = render(<OnCallCoverage revision="old" />); view.rerender(<OnCallCoverage revision="new" />);
    await screen.findByText(/No saved rotation/); resolve({ data: coverage });
    await waitFor(() => expect(screen.queryByText(/Case Analyst/)).toBeNull());
  });
});
