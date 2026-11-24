import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssignedTaskExplorer } from './AssignedTaskExplorer';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const task = { done: false, completed_at: null, task_id: 209, case_id: 7, title: 'Collect late-page evidence', case_title: 'Gateway investigation', case_severity: 'high', case_status: 'open', due_date: '2026-11-20', case_due_date: null };
const result = (page = 1, total = 201) => ({ data: [task], total, page, size: 25, completion: 'open', investigations: 'active', filter_date: new Date().toLocaleDateString('en-CA') });
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (_url, config) => ({ data: { ...result((config?.params as { page: number }).page), filter_date: (config?.params as { today: string }).today } })); });
afterEach(cleanup);
function show() { render(<MemoryRouter><AssignedTaskExplorer /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); }
it('loads only on demand and reaches records beyond the editing cap with stable server pages', async () => {
  render(<MemoryRouter><AssignedTaskExplorer /></MemoryRouter>); expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' }));
  await screen.findByText(/201 matching assigned task records/);
  expect(screen.getByRole('link', { name: /Gateway investigation/ }).getAttribute('href')).toBe('/cases/7?task=209');
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' }));
  await screen.findByText(/Page 2 of 9/); expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ page: 2, size: 25 }) });
});
it('keeps edits separate until apply and sends global filter criteria with explicit calendar date', async () => {
  show(); await screen.findByText(/201 matching/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'Late-page' } });
  fireEvent.change(screen.getByLabelText('Full workload due filter'), { target: { value: 'overdue' } });
  fireEvent.change(screen.getByLabelText('Full workload calendar date'), { target: { value: '2026-11-21' } });
  expect(get).toHaveBeenCalledTimes(1); expect(screen.getByText(/Filter edits are not applied/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: { query: 'Late-page', due: 'overdue', severity: 'all', today: '2026-11-21', completion: 'open', investigations: 'active', page: 1, size: 25 } }));
});
it('does not turn a failed response into an empty-workload claim and retries', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); show(); await screen.findByRole('alert');
  expect(screen.queryByText(/No assigned tasks match/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh full workload page' })); await screen.findByText(/201 matching/);
});
it('rejects mismatched page and date responses', async () => {
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(2), filter_date: (config?.params as { today: string }).today } }));
  show(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
  get.mockResolvedValueOnce({ data: { ...result(), filter_date: '2000-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh full workload page' })); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('ignores a late result after closing the explorer', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  show(); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' }));
  await act(async () => finish({ data: result() })); expect(screen.queryByRole('link')).toBeNull();
});
it('recovers the last server page when remaining tasks disappear', async () => {
  show(); await screen.findByText(/201 matching/);
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(2, 1), data: [], filter_date: (config?.params as { today: string }).today } }));
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ page: 1 }) }));
});

it('rejects invalid task identities without showing links', async () => {
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), data: [{ ...task, task_id: 0 }], filter_date: (config?.params as { today: string }).today } }));
  show(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});

it('requires explicit apply for completed work and inactive investigations, preserving recorded timestamps', async () => {
  show(); await screen.findByText(/201 matching/);
  fireEvent.change(screen.getByLabelText('Full workload completion'), { target: { value: 'completed' } });
  fireEvent.change(screen.getByLabelText('Full workload investigation scope'), { target: { value: 'inactive' } });
  expect(get).toHaveBeenCalledTimes(1);
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), completion: 'completed', investigations: 'inactive', data: [{ ...task, done: true, completed_at: '2026-11-20T18:00:00Z', case_status: 'resolved' }], filter_date: (config?.params as { today: string }).today } }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' }));
  await screen.findByText('Completed checklist task · Recorded completion: 2026-11-20T18:00:00Z');
  expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ completion: 'completed', investigations: 'inactive', page: 1 }) });
  expect(screen.getByText(/A past due date alone/)).toBeTruthy();
});
it('rejects a response with the wrong completion scope or untrustworthy completion type', async () => {
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), completion: 'all', filter_date: (config?.params as { today: string }).today } }));
  show(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), data: [{ ...task, done: 'yes' }], filter_date: (config?.params as { today: string }).today } }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh full workload page' }));
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});

it('refreshes the exact paged workload and notifies the snapshot after a confirmed task edit', async () => {
  const edited = vi.fn(); vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: { id: 209, case_id: 7, title: task.title, done: true, due_date: task.due_date, completed_at: '2026-11-21T00:00:00Z' } });
  render(<MemoryRouter><AssignedTaskExplorer onEdited={edited} /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); await screen.findByText(/201 matching/);
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 9/);
  fireEvent.click(screen.getByRole('button', { name: 'Edit assigned task #209' })); fireEvent.click(screen.getByRole('button', { name: 'Review task change' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm task change' }));
  await waitFor(() => expect(edited).toHaveBeenCalledTimes(1)); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ page: 2 }) }); expect(screen.getByText(/Confirmed the reviewed change/)).toBeTruthy();
});
it('marks an ambiguous write as stale and refreshes only after closing its blocked review', async () => {
  const edited = vi.fn(); vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: {} }); render(<MemoryRouter><AssignedTaskExplorer onEdited={edited} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); await screen.findByText(/201 matching/);
  fireEvent.click(screen.getByRole('button', { name: 'Edit assigned task #209' })); fireEvent.click(screen.getByRole('button', { name: 'Review task change' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm task change' }));
  await screen.findByRole('alert'); expect(get).toHaveBeenCalledTimes(1); expect(edited).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Edit assigned task #209' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Close and refresh workload' })); await waitFor(() => expect(get).toHaveBeenCalledTimes(2)); await waitFor(() => expect(screen.getByRole('button', { name: 'Edit assigned task #209' })).toHaveProperty('disabled', false));
});
it('does not open an editor while the separate snapshot is saving or has drafts', async () => {
  render(<MemoryRouter><AssignedTaskExplorer editingBlocked /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); await screen.findByText(/201 matching/);
  expect(screen.getByRole('button', { name: 'Edit assigned task #209' })).toHaveProperty('disabled', true); expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows full matching summary rather than counting the loaded page and preserves it during draft edits', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...result(), filter_date: (config?.params as { today: string }).today,
    summary: { total: 201, investigations: 8, open: 201, completed: 0, without_due_date: 41, completed_without_timestamp: 0 } } }));
  show(); await screen.findByText('201 matching assigned task records', { exact: false });
  const summary = screen.getByRole('region', { name: 'Matching assigned workload summary' });
  expect(summary.textContent).toContain('Investigations represented8'); expect(summary.textContent).toContain('Without task due date41');
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'unapplied' } }); expect(summary.textContent).toContain('Without task due date41'); expect(get).toHaveBeenCalledTimes(1);
});
it.each([undefined, {total:201,investigations:1,open:200,completed:0,without_due_date:0,completed_without_timestamp:0}, {total:201,investigations:1,open:200,completed:1,without_due_date:0,completed_without_timestamp:0}, {total:201,investigations:1,open:201,completed:0,without_due_date:202,completed_without_timestamp:0}])('keeps page evidence separate from missing or invalid summary %j', async summary => {
  get.mockImplementation(async (_url, config) => ({ data: { ...result(), filter_date: (config?.params as { today: string }).today, summary } })); show(); await screen.findByText(/Full matching summary unavailable/); expect(screen.getByRole('link', {name:/Gateway investigation/})).toBeTruthy();
});
it('applies fixed inclusive windows only after both dates are valid and preserves applied scope during draft edits', async () => {
  show(); await screen.findByText(/201 matching/);
  fireEvent.change(screen.getByLabelText('Full workload due filter'), { target: { value: 'range' } });
  expect(screen.getByRole('button', { name: 'Apply full workload filters' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Full workload due from'), { target: { value: '2026-11-21' } });
  fireEvent.change(screen.getByLabelText('Full workload due through'), { target: { value: '2026-11-20' } });
  expect(screen.getByRole('button', { name: 'Apply full workload filters' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Full workload due from'), { target: { value: '2026-11-20' } });
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), filter_date: (config?.params as { today: string }).today, due_from: (config?.params as { due_from: string }).due_from, due_through: (config?.params as { due_through: string }).due_through } }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' }));
  await screen.findByText(/due: range \(2026-11-20 through 2026-11-20, inclusive\)/);
  expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ due: 'range', due_from: '2026-11-20', due_through: '2026-11-20', page: 1 }) });
  fireEvent.change(screen.getByLabelText('Full workload due through'), { target: { value: '2026-12-01' } });
  expect(screen.getByText(/Filter edits are not applied/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2);
});
it.each(['missing', 'boundary', 'row'])('rejects unverifiable fixed-window evidence: %s', async kind => {
  show(); await screen.findByText(/201 matching/);
  fireEvent.change(screen.getByLabelText('Full workload due filter'), { target: { value: 'range' } });
  fireEvent.change(screen.getByLabelText('Full workload due from'), { target: { value: '2026-11-20' } });
  fireEvent.change(screen.getByLabelText('Full workload due through'), { target: { value: '2026-11-24' } });
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), filter_date: (config?.params as { today: string }).today, ...(kind === 'missing' ? {} : { due_from: kind === 'boundary' ? '2026-11-19' : '2026-11-20', due_through: '2026-11-24' }), data: [{ ...task, due_date: kind === 'row' ? null : task.due_date }] } }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' }));
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/No assigned tasks match/)).toBeNull();
});
it('exports only the loaded page under applied filters, never unsaved drafts or all matching records', async () => {
  show(); await screen.findByText(/201 matching/);
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 9/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'unsaved draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review this workload page CSV (1 records only)' }));
  const dialog = screen.getByRole('dialog'); expect(dialog.textContent).toContain('Only page 2: 1 loaded task records of 201'); expect(dialog.textContent).toContain('query ""'); expect(dialog.textContent).not.toContain('unsaved draft'); expect(dialog.textContent).toContain('Other pages are not included'); expect(get).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText('Cancel workload page export')); expect(screen.queryByRole('dialog')).toBeNull();
});
it('blocks page export when the task snapshot is known stale', async () => {
  render(<MemoryRouter><AssignedTaskExplorer editingBlocked /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Explore all assigned tasks beyond the editing snapshot' })); await screen.findByText(/201 matching/);
  expect(screen.getByRole('button', { name: 'Review this workload page CSV (1 records only)' })).toHaveProperty('disabled', true);
});
it('keeps global investigation counts separate from the loaded task page and draft filters', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...result((config?.params as { page: number }).page), filter_date: (config?.params as { today: string }).today, by_investigation: [{ case_id: 7, total: 201, open: 201, completed: 0, without_due_date: 0 }], investigation_groups_total: 1, investigation_group_limit: 50 } }));
  show(); await screen.findByText(/201 matching tasks · 201 open/);
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 9/);
  expect(screen.getByText(/201 matching tasks · 201 open/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'draft not applied' } });
  expect(screen.getByText(/201 matching tasks · 201 open/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2);
});
