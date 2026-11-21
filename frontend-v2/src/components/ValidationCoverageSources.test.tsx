import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ValidationCoverageSources } from './ValidationCoverageSources';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const props = { techniqueId: 'T1059', techniqueName: 'Command', execution: 'all', runStatus: 'completed' };
const row = { step_id: 81, step_number: 2, run_id: 99, run_name: 'Saved test run', run_status: 'completed', run_mode: 'dry_run', test_name: 'Recorded shell test', step_status: 'completed', simulated: null, actual_result: null, executed_at: null, control_result_count: 0, recorded_detected: 0, recorded_not_detected: 0, unknown_outcomes: 0 };
const snapshot = { technique_id: 'T1059', technique_name: 'Command', execution: 'all', run_status: 'completed', page: 1, size: 10, total: 1, retrieved_at: '2026-11-21T08:00:00Z', records: [row] };
const show = () => render(<MemoryRouter><ValidationCoverageSources {...props} /></MemoryRouter>);
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Review source steps for T1059: Command' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); });
afterEach(cleanup);
it('loads only requested exact group on demand with current scope and safe exact run links', async () => {
  show(); expect(get).not.toHaveBeenCalled(); open(); await screen.findByText('Step #81, position 2: Recorded shell test');
  expect(get).toHaveBeenCalledWith('/validation/coverage-evidence/steps', { params: { technique_id: 'T1059', technique_name: 'Command', execution: 'all', run_status: 'completed', page: 1, size: 10 } });
  expect(screen.getByRole('link', { name: 'Open saved run #99: Saved test run' }).getAttribute('href')).toBe('/validation?run=99');
  expect(screen.getByText('Execution flag: Not recorded · Step result: Not recorded')).toBeTruthy(); expect(screen.getByText('No control results saved for this step.')).toBeTruthy(); expect(screen.getByText(/not proof that live controls fired/)).toBeTruthy();
});
it('paginates full source counts and refreshes after page shrink', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, total: 11 } }); show(); open(); await screen.findByText(/11 matching saved steps/);
  get.mockResolvedValueOnce({ data: { ...snapshot, page: 2, total: 11, records: [{ ...row, step_id: 82 }] } }); fireEvent.click(screen.getByText('Next source steps')); await screen.findByText(/Step #82/);
  get.mockResolvedValueOnce({ data: { ...snapshot, page: 2 } }).mockResolvedValueOnce({ data: snapshot }); fireEvent.click(screen.getByText('Refresh source steps')); await screen.findByText(/Step #81/); expect(get.mock.calls.at(-1)?.[1]).toMatchObject({ params: { page: 1 } });
});
it.each([{ technique_name: 'Different' }, { execution: 'simulated' }, { page: 2 }, { total: -1 }, { records: [{ ...row, run_id: -2 }] }])('rejects mismatched source evidence %j', async change => {
  get.mockResolvedValueOnce({ data: { ...snapshot, ...change } }); show(); open(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('ignores late reads after hiding and starts a new scope without automatic retrieval', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); open(); fireEvent.click(screen.getByText('Hide source steps')); await act(async () => finish({ data: snapshot })); expect(screen.queryByRole('link')).toBeNull();
  view.rerender(<MemoryRouter><ValidationCoverageSources {...props} execution="unknown" /></MemoryRouter>); expect(get).toHaveBeenCalledTimes(1); expect(screen.queryByText('Loading source steps...')).toBeNull();
});
it('keeps source failure distinct from no matches and retries', async () => {
  get.mockRejectedValueOnce(Error('Unavailable')); show(); open(); await screen.findByRole('alert'); expect(screen.queryByText(/No saved steps currently match/)).toBeNull(); get.mockResolvedValueOnce({ data: { ...snapshot, total: 0, records: [] } }); fireEvent.click(screen.getByText('Retry source steps')); await screen.findByText(/No saved steps currently match/); expect(screen.queryByRole('link')).toBeNull();
});
it('preserves false execution flags and zero outcomes as real saved values', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, records: [{ ...row, simulated: false, actual_result: 'missed', control_result_count: 2, recorded_not_detected: 1, unknown_outcomes: 1 }] } }); show(); open(); await screen.findByText('Execution flag: Non-simulated · Step result: missed'); expect(screen.getByText('2 control results: 0 detected, 1 not detected, 1 unknown outcomes.')).toBeTruthy();
});
