import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../api/client';
import { CaseResponsePlans } from './CaseResponsePlans';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const plan = { id: 21, case_id: 7, status: 'partial', autonomy_level: 'L1', created_by: 'agent', created_at: '2026-11-20T00:00:00Z', actions: [{ action_type: 'notify' }] };
const props = { caseId: 7, onSeed: vi.fn(), seedBusy: false, tasksUnavailable: false };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: { data: [plan], total: 1, page: 1, size: 10 } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const show = () => render(<MemoryRouter><CaseResponsePlans {...props} /></MemoryRouter>);
it('opens exact evidence links and keeps checklist seeding separate from plan decisions', async () => {
  show(); const link = await screen.findByText('Plan #21');
  expect(link.closest('a')?.getAttribute('href')).toBe('/response-plans?plan=21');
  expect(get).toHaveBeenCalledWith('/response-plans/', { params: { case_id: 7, page: 1, size: 10 } });
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Seed checklist from plan 21' })); expect(props.onSeed).not.toHaveBeenCalled();
  await screen.findByRole('region', { name: 'Checklist import preview for plan 21' });
});
it('loads older pages and resets the page when status changes', async () => {
  get.mockImplementation(async (_url, config) => { const { page, status } = config?.params as { page: number; status?: string }; return { data: { data: [{ ...plan, id: page === 1 ? 21 : 11 }], total: status ? 1 : 11, page, size: 10 } }; });
  show(); await screen.findByText('Plan #21'); fireEvent.click(screen.getByRole('button', { name: 'Next investigation plans' }));
  await screen.findByText('Plan #11'); expect(screen.queryByText('Plan #21')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter investigation response plans by status'), { target: { value: 'partial' } });
  await screen.findByText('Plan #21'); expect(get).toHaveBeenLastCalledWith('/response-plans/', { params: { case_id: 7, page: 1, size: 10, status: 'partial' } });
});
it('ignores obsolete page results after a filter change', async () => {
  let finish!: (v: unknown) => void;
  get.mockResolvedValueOnce({ data: { data: [plan], total: 11, page: 1, size: 10 } }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  show(); await screen.findByText('Plan #21'); fireEvent.click(screen.getByRole('button', { name: 'Next investigation plans' }));
  get.mockResolvedValueOnce({ data: { data: [{ ...plan, id: 30 }], total: 1, page: 1, size: 10 } });
  fireEvent.change(screen.getByLabelText('Filter investigation response plans by status'), { target: { value: 'completed' } });
  await screen.findByText('Plan #30'); await act(async () => finish({ data: { data: [{ ...plan, id: 11 }], total: 11, page: 2, size: 10 } }));
  expect(screen.queryByText('Plan #11')).toBeNull(); expect(screen.getByText('Plan #30')).toBeTruthy();
});
it('remounts investigation paging when the visible case changes and ignores its old result', async () => {
  let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = show(); get.mockResolvedValueOnce({ data: { data: [{ ...plan, id: 80, case_id: 8 }], total: 1, page: 1, size: 10 } });
  view.rerender(<MemoryRouter><CaseResponsePlans {...props} caseId={8} /></MemoryRouter>);
  await screen.findByText('Plan #80'); await act(async () => finish({ data: { data: [plan], total: 1, page: 1, size: 10 } }));
  expect(screen.queryByText('Plan #21')).toBeNull(); expect(get).toHaveBeenLastCalledWith('/response-plans/', { params: { case_id: 8, page: 1, size: 10 } });
});
it.each([{ ...plan, case_id: 8 }, { ...plan, id: 0 }])('rejects mismatched or malformed plan identity', async row => {
  get.mockResolvedValue({ data: { data: [row], total: 1, page: 1, size: 10 } }); show();
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button', { name: /Seed checklist/ })).toBeNull();
});
it('retries errors without turning missing access into an empty plan list', async () => {
  get.mockRejectedValueOnce(new Error('Plans unavailable')); show(); await screen.findByText('Plans unavailable');
  expect(screen.queryByText(/No response plans match/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry investigation response plans' })); await screen.findByText('Plan #21');
});
it('recovers a page whose last plan disappeared on refresh', async () => {
  get.mockResolvedValueOnce({ data: { data: [plan], total: 11, page: 1, size: 10 } }).mockResolvedValueOnce({ data: { data: [{ ...plan, id: 11 }], total: 11, page: 2, size: 10 } });
  show(); await screen.findByText('Plan #21'); fireEvent.click(screen.getByRole('button', { name: 'Next investigation plans' })); await screen.findByText('Plan #11');
  get.mockResolvedValueOnce({ data: { data: [], total: 1, page: 2, size: 10 } }).mockResolvedValueOnce({ data: { data: [plan], total: 1, page: 1, size: 10 } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh investigation plans' })); await screen.findByText('Plan #21');
  await waitFor(() => expect((screen.getByRole('button', { name: 'Previous investigation plans' }) as HTMLButtonElement).disabled).toBe(true));
});
it('keeps checklist mutation disabled when its source workflow is unavailable or busy', async () => {
  render(<MemoryRouter><CaseResponsePlans {...props} tasksUnavailable /></MemoryRouter>); await screen.findByText('Plan #21');
  expect((screen.getByRole('button', { name: 'Seed checklist from plan 21' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps two-plan comparison selection across pages and limits selection to two', async () => {
  get.mockImplementation(async (_url, config) => { const { page } = config?.params as { page: number }; return { data: { data: page === 1 ? [plan] : [{ ...plan, id: 11 }, { ...plan, id: 10 }], total: 12, page, size: 10 } }; });
  show(); fireEvent.click(await screen.findByLabelText('Select plan 21 for comparison'));
  fireEvent.click(screen.getByRole('button', { name: 'Next investigation plans' }));
  fireEvent.click(await screen.findByLabelText('Select plan 11 for comparison'));
  expect(screen.getByRole('link', { name: 'Open selected plan comparison' }).getAttribute('href')).toBe('/response-plans?compare_from=21&compare_to=11');
  expect((screen.getByLabelText('Select plan 10 for comparison') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear comparison selection' }));
  expect(screen.queryByRole('link', { name: 'Open selected plan comparison' })).toBeNull();
  expect((screen.getByLabelText('Select plan 10 for comparison') as HTMLInputElement).disabled).toBe(false);
});
it('clears comparison selections when the visible investigation changes', async () => {
  const view = show(); fireEvent.click(await screen.findByLabelText('Select plan 21 for comparison'));
  get.mockResolvedValue({ data: { data: [{ ...plan, case_id: 8, id: 30 }], total: 1 } });
  view.rerender(<MemoryRouter><CaseResponsePlans {...props} caseId={8} /></MemoryRouter>);
  await screen.findByText('Plan #30'); expect(screen.getByText('Compare saved plans: Select a baseline, then a comparison plan.')).toBeTruthy();
});

it('only offers draft generation when its caller confirms case ownership', async () => {
  const view = render(<MemoryRouter><CaseResponsePlans {...props} /></MemoryRouter>); expect(screen.queryByRole('button', { name: 'Review draft generation' })).toBeNull();
  view.rerender(<MemoryRouter><CaseResponsePlans {...props} canDraft /></MemoryRouter>); expect(screen.getByRole('button', { name: 'Review draft generation' })).toBeTruthy();
});
