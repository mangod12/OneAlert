import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponseSimulationPreflight } from './ResponseSimulationPreflight';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { source_position: 1, action_type: 'notify', target: 'local', priority: 99, priority_defaulted: true, shape_valid: true, handler_available: true, recorded_policy_approved: false, simulation_order: 1 };
const fixture = { plan_id: 7, case_id: 10, status: 'approved', execution_mode: 'simulated', retrieved_at: '2026-11-21T11:00:00Z', action_count: 1, supported_count: 1, unsupported_count: 0, invalid_count: 0, shape_valid: true, order_available: true, records: [row] };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Inspect simulation handler readiness' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); });
afterEach(cleanup);
it('fetches only on demand and distinguishes simulated support from permission and live readiness', async () => {
  render(<ResponseSimulationPreflight planId={7} />); expect(get).not.toHaveBeenCalled(); open();
  await screen.findByText('Local simulation handler recognized · Action shape usable');
  expect(get).toHaveBeenCalledWith('/response-plans/7/simulation-preflight');
  expect(screen.getByText(/not a configured live integration/)).toBeTruthy();
  expect(screen.getByText('Recorded policy flag: Not approved')).toBeTruthy();
  expect(screen.getByText('Priority: 99 (default 99) · Simulation order: 1')).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('paginates only the complete loaded action list', async () => {
  get.mockResolvedValue({ data: { ...fixture, action_count: 11, supported_count: 11, records: Array.from({ length: 11 }, (_, index) => ({ ...row, source_position: index + 1, simulation_order: index + 1 })) } });
  render(<ResponseSimulationPreflight planId={7} />); open(); await screen.findByText(/11 saved actions/);
  fireEvent.click(screen.getByRole('button', { name: 'More preflight actions' }));
  expect(screen.getByText('Saved position 11: notify')).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1);
});
it('does not call unsupported handlers safe and hides unavailable ordering', async () => {
  get.mockResolvedValue({ data: { ...fixture, supported_count: 0, unsupported_count: 1, invalid_count: 1, shape_valid: false, order_available: false, records: [{ ...row, action_type: 'legacy', handler_available: false, shape_valid: false, simulation_order: null }] } });
  render(<ResponseSimulationPreflight planId={7} />); open(); await screen.findByText('Unsupported local handler · Invalid action shape');
  expect(screen.getByText(/No order is guessed/)).toBeTruthy();
});
it.each([{ plan_id: 8 }, { records: [] }, { supported_count: 2 }, { execution_mode: 'live' }, { records: [{ ...row, target: {} }] }])('rejects mismatched or malformed result %j', async change => {
  get.mockResolvedValue({ data: { ...fixture, ...change } }); render(<ResponseSimulationPreflight planId={7} />); open();
  expect((await screen.findByRole('alert')).textContent).toContain('did not match'); expect(screen.queryByText(/1 saved actions/)).toBeNull();
});
it('clears stale responses on close or a different plan and can retry errors', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ResponseSimulationPreflight planId={7} />); open(); open();
  await act(async () => finish({ data: fixture })); expect(screen.queryByText(/1 saved actions/)).toBeNull();
  get.mockRejectedValueOnce(new Error('Unavailable')); open(); await screen.findByRole('alert');
  get.mockResolvedValueOnce({ data: fixture }); fireEvent.click(screen.getByRole('button', { name: 'Refresh simulation preflight' })); await screen.findByText(/1 saved actions/);
  get.mockResolvedValueOnce({ data: { ...fixture, plan_id: 8 } }); view.rerender(<ResponseSimulationPreflight planId={8} />);
  await screen.findByText(/Plan #8/); expect(screen.queryByText(/Plan #7/)).toBeNull();
});
