import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ValidationComparison } from './ValidationComparison';
import type { ComparableRun, ComparableStep } from '../utils/validationComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const step = (extra: Partial<ComparableStep> = {}): ComparableStep => ({ id: 1, technique_id: 'T1110', test_name: 'Password guessing', test_type: 'atomic', actual_result: 'detected', status: 'completed', simulated: true, ...extra });
const current: ComparableRun = { id: 8, name: 'Current recorded run', mode: 'dry_run', status: 'completed', scope: { asset_ids: [7] }, created_at: '2026-11-20T08:00:00Z', steps: [step({ actual_result: 'missed' })] };
const baseline: ComparableRun = { ...current, id: 7, name: 'Baseline recorded run', steps: [step()] };
function open() { render(<ValidationComparison current={current} onClose={vi.fn()} />); }
function compare(id = '7') { fireEvent.change(screen.getByLabelText('Baseline validation run ID'), { target: { value: id } }); fireEvent.click(screen.getByRole('button', { name: 'Compare outcomes' })); }
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: { data: baseline } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('waits for an explicit baseline and only reads owned run evidence', async () => {
  open(); expect(get).not.toHaveBeenCalled(); compare();
  expect(await screen.findByText('changed: 1')).toBeTruthy();
  expect(screen.getByText('Result: detected')).toBeTruthy();
  expect(screen.getByText('Result: missed')).toBeTruthy();
  expect(screen.getByText(/No tests are executed/)).toBeTruthy();
  expect(get).toHaveBeenCalledWith('/validation/runs/7');
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
it.each(['8', '0', '-1', 'abc', '1.1', '9007199254740992'])('rejects an unsafe or same-run ID: %s', id => {
  open(); compare(id); expect(screen.getByRole('alert').textContent).toContain('different positive run ID'); expect(get).not.toHaveBeenCalled();
});
it('makes failures retryable and rejects a mismatched response ID', async () => {
  open(); get.mockRejectedValueOnce(new Error('Run unavailable')); compare();
  await screen.findByRole('alert'); expect(screen.queryByText('changed: 0')).toBeNull();
  get.mockResolvedValueOnce({ data: { data: { ...baseline, id: 4 } } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare outcomes' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('did not match'));
  fireEvent.click(screen.getByRole('button', { name: 'Compare outcomes' }));
  expect(await screen.findByText('changed: 1')).toBeTruthy();
});
it.each(['success', 'failure'])('ignores an obsolete baseline %s after the draft changes', async outcome => {
  let resolveOld!: (data: unknown) => void; let rejectOld!: (error: Error) => void;
  get.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }));
  open(); compare();
  fireEvent.change(screen.getByLabelText('Baseline validation run ID'), { target: { value: '6' } });
  get.mockResolvedValue({ data: { data: { ...baseline, id: 6, name: 'New baseline' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare outcomes' }));
  await screen.findByText(/Baseline run #6: New baseline/);
  await act(async () => { if (outcome === 'success') resolveOld({ data: { data: baseline } }); else rejectOld(new Error('Old failure')); });
  expect(screen.getByText(/Baseline run #6: New baseline/)).toBeTruthy();
  expect(screen.queryByText(/Baseline run #7:/)).toBeNull(); expect(screen.queryByText('Old failure')).toBeNull();
});
it('distinguishes different modes, partial runs, missing flags and recorded scopes', async () => {
  get.mockResolvedValue({ data: { data: { ...baseline, mode: 'lab', status: 'running', scope: { asset_ids: [9] }, steps: [step({ simulated: undefined, actual_result: null })] } } });
  open(); compare(); await screen.findByText('changed: 1');
  expect(screen.getByText(/different execution modes/)).toBeTruthy();
  expect(screen.getByText(/not completed/)).toBeTruthy();
  expect(screen.getByText('Execution: Not recorded')).toBeTruthy();
  expect(screen.getByText('Result: Not recorded')).toBeTruthy();
  fireEvent.click(screen.getByText('Inspect recorded run scopes'));
  expect(screen.getByText(/"asset_ids": \[\s+9/)).toBeTruthy();
});
it('keeps duplicates ambiguous instead of guessing at matching outcomes', async () => {
  get.mockResolvedValue({ data: { data: { ...baseline, steps: [step(), step()] } } });
  open(); compare(); await screen.findByText('ambiguous: 1');
  expect(screen.getByText(/Cannot safely pair duplicate steps/)).toBeTruthy();
  expect(screen.queryByText('Result: detected')).toBeNull();
});
it('pages and searches groups without extra requests, and exports all filtered pages', async () => {
  const many = { ...current, steps: Array.from({ length: 22 }, (_, index) => step({ id: index, test_name: `record-${String(index).padStart(2, '0')}` })) };
  get.mockResolvedValue({ data: { data: { ...baseline, steps: [] } } });
  let blob!: Blob;
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn((value: Blob) => { blob = value; return 'blob:comparison'; }), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ValidationComparison current={many} onClose={vi.fn()} />); compare();
  await screen.findByText('added: 22');
  expect(screen.queryByRole('heading', { name: 'T1110 · record-21' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More outcome groups' }));
  expect(screen.getByRole('heading', { name: 'T1110 · record-10' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Export matching outcome comparison CSV' }));
  const content = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
  expect(content).toContain('record-21'); expect(content).toContain('record-00');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:comparison');
  fireEvent.change(screen.getByLabelText('Search validation comparison'), { target: { value: 'record-21' } });
  expect(screen.getByRole('heading', { name: 'T1110 · record-21' })).toBeTruthy();
  expect(screen.getByText('1 of 22 groups match. Page 1 of 1.')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(1);
});
it('does not present empty evidence as verified matching coverage', async () => {
  get.mockResolvedValue({ data: { data: { ...baseline, steps: [] } } });
  render(<ValidationComparison current={{ ...current, steps: [] }} onClose={vi.fn()} />); compare();
  expect(await screen.findByText(/Neither run has recorded steps/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Export matching outcome comparison CSV' }) as HTMLButtonElement).disabled).toBe(true);
});

it('does not turn malformed baseline evidence into an empty or matching result', async () => {
  get.mockResolvedValue({ data: { data: { ...baseline, steps: [null] } } });
  open(); compare();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('readable step evidence'));
  expect(screen.queryByText('changed: 0')).toBeNull();
});
