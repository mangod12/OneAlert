import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ValidationCoverageEvidence } from './ValidationCoverageEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const technique = { technique_id: 'T1059', technique_name: 'Command execution', run_count: 2, step_count: 3, simulated_steps: 1, non_simulated_steps: 1, unknown_execution_steps: 1, control_result_count: 4, recorded_detected: 2, recorded_not_detected: 1, unknown_outcomes: 1, recorded_detection_percentage: 66.7 };
const snapshot = { schema_version: 1, scope: 'Recorded control results, not proof of live detections.', execution: 'all', run_status: 'completed', page: 1, size: 20, total: 1, retrieved_at: '2026-11-20T18:00:00Z', techniques: [technique] };
const open = async () => { render(<ValidationCoverageEvidence />); fireEvent.click(screen.getByRole('button', { name: 'Review coverage evidence' })); await screen.findByText('T1059 · Command execution'); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Recorded validation coverage evidence', () => {
  it('reads only on review and makes execution, denominators and count units explicit', async () => {
    render(<ValidationCoverageEvidence />); expect(get).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Review coverage evidence' })); await screen.findByText('T1059 · Command execution');
    expect(get).toHaveBeenCalledWith('/validation/coverage-evidence', { params: { execution: 'all', run_status: 'completed', page: 1, size: 20 } });
    expect(screen.getByText('2 recorded runs · 3 steps · 4 control results')).toBeTruthy();
    expect(screen.getByText('Steps by execution flag: 1 simulated, 1 non-simulated, 1 unknown')).toBeTruthy();
    expect(screen.getByText('66.7%')).toBeTruthy(); expect(screen.getByText(/Missing outcomes are excluded from the denominator/)).toBeTruthy();
  });
  it('keeps unavailable rates distinct from genuine zero and retains steps without controls', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, total: 2, techniques: [{ ...technique, technique_id: 'T1046', technique_name: 'No control records', control_result_count: 0, recorded_detected: 0, recorded_not_detected: 0, unknown_outcomes: 0, recorded_detection_percentage: null }, { ...technique, recorded_detected: 0, recorded_detection_percentage: 0 }] } });
    await open(); expect(screen.getByText('Unavailable, no known outcomes')).toBeTruthy(); expect(screen.getByText('0%')).toBeTruthy(); expect(screen.getByText('No control results were recorded for these steps.')).toBeTruthy();
  });
  it('clears stale groups when execution filters change and excludes old responses', async () => {
    let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ValidationCoverageEvidence />); fireEvent.click(screen.getByRole('button', { name: 'Review coverage evidence' }));
    get.mockResolvedValueOnce({ data: { ...snapshot, execution: 'unknown', techniques: [{ ...technique, technique_name: 'Unknown execution' }] } });
    fireEvent.change(screen.getByLabelText('Coverage evidence execution filter'), { target: { value: 'unknown' } }); await screen.findByText('T1059 · Unknown execution');
    await act(async () => finish({ data: snapshot })); expect(screen.queryByText('T1059 · Command execution')).toBeNull();
  });
  it('filters status and retries unavailable evidence without inventing empty coverage', async () => {
    await open(); get.mockRejectedValueOnce(new Error('Unavailable')); fireEvent.change(screen.getByLabelText('Coverage evidence run status'), { target: { value: 'failed' } });
    await screen.findByRole('alert'); expect(screen.queryByText('T1059 · Command execution')).toBeNull(); expect(screen.queryByRole('button', { name: 'Download loaded coverage page JSON' })).toBeNull();
    get.mockResolvedValueOnce({ data: { ...snapshot, run_status: 'failed', techniques: [], total: 0 } }); fireEvent.click(screen.getByRole('button', { name: 'Retry coverage evidence' }));
    await screen.findByText(/not evidence of zero detections or complete coverage/);
  });
  it('rejects a mismatched scope', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, run_status: 'all' } }); render(<ValidationCoverageEvidence />); fireEvent.click(screen.getByRole('button', { name: 'Review coverage evidence' }));
    await screen.findByText(/did not match the requested scope/); expect(screen.queryByText('T1059 · Command execution')).toBeNull();
  });
  it('paginates groups and resets the page on scope changes', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot, total: 21 } }); await open();
    get.mockResolvedValueOnce({ data: { ...snapshot, total: 21, page: 2, techniques: [{ ...technique, technique_name: 'Second page' }] } }); fireEvent.click(screen.getByRole('button', { name: 'Next coverage groups' })); await screen.findByText('T1059 · Second page');
    get.mockResolvedValueOnce({ data: { ...snapshot, execution: 'simulated' } }); fireEvent.change(screen.getByLabelText('Coverage evidence execution filter'), { target: { value: 'simulated' } }); await screen.findByText('T1059 · Command execution');
    expect(get.mock.calls.at(-1)?.[1]).toEqual({ params: { execution: 'simulated', run_status: 'completed', page: 1, size: 20 } });
  });
  it('downloads a loaded evidence page without running or changing validation', async () => {
    const create = vi.fn().mockReturnValue('blob:coverage'); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); await open(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded coverage page JSON' }));
    expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(create.mock.calls[0][0].type).toBe('application/json'); expect(get).toHaveBeenCalledTimes(1);
  });
});
