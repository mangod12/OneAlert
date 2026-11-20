import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssessmentComparison } from './AssessmentComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const first = { id: 3, control_id: 11, status: 'partial', evidence_type: null, evidence_detail: null, assessed_at: '2026-11-20T18:00:00Z', assessed_by: 'reviewer' };
const second = { ...first, id: 9, status: 'compliant', evidence_type: 'manual', evidence_detail: 'Retained evidence\nSecond line' };
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => ({ data: url.endsWith('/3') ? first : second })); });
afterEach(cleanup);
function show(ids = [3, 9]) { return render(<AssessmentComparison controlId={11} ids={ids} />); }
function load() { fireEvent.click(screen.getByRole('button', { name: 'Load selected assessment comparison' })); }
it('reloads exact selected records only after explicit action and compares full recorded values', async () => {
  show(); expect(get).not.toHaveBeenCalled(); load(); await screen.findByText(/3 of 5 recorded fields differ/);
  expect(get.mock.calls.map(call => call[0])).toEqual(['/compliance/assessments/3', '/compliance/assessments/9']);
  expect(screen.getByText(/Retained evidence/).textContent).toBe(second.evidence_detail);
  expect(screen.getAllByText('(null: not recorded)')).toHaveLength(2);
  expect(screen.queryByText(/Recorded assessor ·/)).toBeNull();
  fireEvent.click(screen.getByLabelText('Show differing assessment fields only'));
  expect(screen.getByText('Recorded assessor · Same recorded value')).toBeTruthy();
  expect(screen.getByText(/not an atomic snapshot or proof of compliance/)).toBeTruthy();
});
it('preserves empty evidence text as different from a missing value', async () => {
  get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: { ...first, id: 9, evidence_detail: '' } });
  show(); load(); await screen.findByText(/1 of 5 recorded fields differ/);
  expect(screen.getByText('(null: not recorded)')).toBeTruthy(); expect(screen.getByText('(empty text)')).toBeTruthy();
});
it('does not turn identical recorded fields into a compliance conclusion', async () => {
  get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: { ...first, id: 9 } });
  show(); load(); await screen.findByText(/0 of 5 recorded fields differ/);
  expect(screen.getByText(/does not establish compliance or unchanged evidence/)).toBeTruthy();
});
it.each([{ id: 99 }, { control_id: 12 }, { evidence_detail: {} }, { assessed_by: null }])('rejects mismatched or malformed comparison data %j', async override => {
  get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: { ...second, ...override } }); show(); load(); await screen.findByRole('alert');
  expect(screen.queryByText(/of 5 recorded fields differ/)).toBeNull();
});
it('retains unavailable errors without claiming two records are equal and supports retry', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); show(); load(); await screen.findByRole('alert'); expect(screen.queryByText(/identical/)).toBeNull();
  load(); await screen.findByText(/3 of 5 recorded fields differ/);
});
it('requires distinct record choices and clears previous results when the selection changes', async () => {
  const view = show(); load(); await screen.findByText(/3 of 5 recorded fields differ/);
  view.rerender(<AssessmentComparison controlId={11} ids={[3, 3]} />); expect(screen.queryByText(/3 of 5/)).toBeNull(); load(); await screen.findByRole('alert'); expect(get).toHaveBeenCalledTimes(2);
});
it('ignores a late comparison result after a different control is selected', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); load();
  view.rerender(<AssessmentComparison controlId={12} ids={[4, 8]} />);
  await act(async () => finish({ data: first })); expect(screen.queryByText(/of 5 recorded fields differ/)).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
});
