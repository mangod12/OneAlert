import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssignedTaskExplorer } from './AssignedTaskExplorer';
vi.mock('./SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
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
it('drills into exact matching investigation using applied filters, not pending drafts, and can remove only that scope', async () => {
  get.mockImplementation(async (_url, config) => {
    const p = config?.params as { today: string; page: number; investigation_id?: number };
    return { data: { ...result(p.page), ...(p.investigation_id ? { investigation_id: p.investigation_id } : {}), filter_date: p.today, by_investigation: [{ case_id: 7, total: 201, open: 201, completed: 0, without_due_date: 0 }], investigation_groups_total: 1, investigation_group_limit: 50 } };
  });
  show(); await screen.findByText(/201 matching tasks · 201 open/);
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 9/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'unsaved draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Explore matching tasks in investigation #7' }));
  await screen.findByText(/exact investigation #7/);
  expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ investigation_id: 7, page: 1, query: '' }) });
  expect(screen.getByText(/Filter edits are not applied/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review this workload page CSV (1 records only)' })); expect(screen.getByRole('dialog').textContent).toContain('exact investigation #7'); fireEvent.click(screen.getByText('Cancel workload page export'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove applied investigation scope' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.not.objectContaining({ investigation_id: expect.anything() }) }));
  expect((screen.getByLabelText('Search full assigned workload') as HTMLInputElement).value).toBe('unsaved draft');
});
it.each(['echo', 'row'])('rejects wrong exact-investigation evidence %s', async kind => {
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), filter_date: (config?.params as { today: string }).today, by_investigation: [{ case_id: 7, total: 201, open: 201, completed: 0, without_due_date: 0 }], investigation_groups_total: 1, investigation_group_limit: 50 } }));
  show(); await screen.findByText(/201 matching tasks · 201 open/);
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(), filter_date: (config?.params as { today: string }).today, investigation_id: kind === 'echo' ? 8 : 7, data: [{ ...task, case_id: kind === 'row' ? 8 : 7 }] } }));
  fireEvent.click(screen.getByRole('button', { name: 'Explore matching tasks in investigation #7' }));
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});

it('applies server-wide sort only on apply, keeps it on later pages and requires echoed sort', async () => {
  show(); await screen.findByText(/201 matching/);
  fireEvent.change(screen.getByLabelText('Full workload sort'), { target: { value: 'task_due' } });
  expect(get).toHaveBeenCalledTimes(1);
  get.mockImplementation(async (_url, config) => { const p = config?.params as { page: number; today: string; sort: string }; return { data: { ...result(p.page), sort: p.sort, filter_date: p.today } }; });
  fireEvent.click(screen.getByRole('button', { name: 'Apply full workload filters' })); await screen.findByText(/task due date ascending, undated last/);
  expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ sort: 'task_due', page: 1 }) });
  fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 9/);
  expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer', { params: expect.objectContaining({ sort: 'task_due', page: 2 }) });
  get.mockImplementationOnce(async (_url, config) => ({ data: { ...result(2), sort: 'title', filter_date: (config?.params as { today: string }).today } }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh full workload page' })); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});

it('reviews all loaded investigation counts rather than task-page sample and excludes filter drafts', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...result(), filter_date: (config?.params as { today: string }).today, by_investigation: [{ case_id: 7, total: 201, open: 201, completed: 0, without_due_date: 0 }], investigation_groups_total: 1, investigation_group_limit: 50 } }));
  show(); await screen.findByText(/201 matching assigned task records/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), { target: { value: 'unapplied draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review loaded investigation summary CSV (up to 50 groups)' }));
  const dialog = screen.getByRole('dialog'); expect(dialog.textContent).toContain('Investigation #7: 201 matching tasks'); expect(dialog.textContent).toContain('1 loaded groups of 1'); expect(dialog.textContent).not.toContain('unapplied draft'); expect(dialog.textContent).not.toContain('Collect late-page evidence');
  expect(get).toHaveBeenCalledTimes(1); expect(apiClient.patch).not.toHaveBeenCalled();
});
it('does not enable summary export without validated loaded groups', async () => {
  show(); await screen.findByText(/201 matching assigned/); expect(screen.getByRole('button', { name: 'Review loaded investigation summary CSV (up to 50 groups)' })).toHaveProperty('disabled', true);
});

it('reviews a late-page task link without another request or task write and drops the review on page navigation', async () => {
  const write = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  show(); await screen.findByText(/201 matching/); fireEvent.click(screen.getByRole('button', { name: 'Next workload page' })); await screen.findByText(/Page 2 of 9/);
  const reads = get.mock.calls.length; fireEvent.click(screen.getByRole('button', { name: 'Review assigned task #209 link' }));
  expect(screen.getByRole('dialog').textContent).toContain('Gateway investigation'); expect(get).toHaveBeenCalledTimes(reads); expect(apiClient.patch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy ID-only assigned task link' })); await screen.findByText(/ID-only assigned task link copied/); expect(write).toHaveBeenCalledWith(`${window.location.origin}/app/cases/7?task=209`);
  fireEvent.click(screen.getByRole('button', { name: 'Close assigned task link review' })); fireEvent.click(screen.getByRole('button', { name: 'Previous workload page' })); await screen.findByText(/Page 1 of 9/); expect(screen.queryByRole('dialog')).toBeNull();
});

it('returns from investigation drilldown to exact prior applied filters/page without applying or discarding drafts', async () => {
  get.mockImplementation(async (_url, config) => { const p=config?.params as Record<string, unknown>; return { data: { ...result(Number(p.page)), filter_date:p.today, investigation_id:p.investigation_id, by_investigation:[{case_id:7,total:201,open:201,completed:0,without_due_date:0}], investigation_groups_total:1, investigation_group_limit:50 } }; });
  show(); await screen.findByText(/201 matching assigned task records/); fireEvent.click(screen.getByRole('button', {name:'Next workload page'})); await screen.findByText(/Page 2 of 9/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'), {target:{value:'unapplied private draft'}});
  fireEvent.click(screen.getByText('Matching assigned workload by investigation')); fireEvent.click(screen.getByRole('button',{name:'Explore matching tasks in investigation #7'}));
  await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({query:'',investigation_id:7,page:1})}));
  await screen.findByText(/Applied investigation #7 only/); expect((screen.getByLabelText('Search full assigned workload') as HTMLInputElement).value).toBe('unapplied private draft');
  fireEvent.click(screen.getByRole('button',{name:'Return to prior applied workload search'}));
  await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({query:'',page:2})}));
  expect(get.mock.calls.at(-1)?.[1]?.params).not.toHaveProperty('investigation_id'); expect((screen.getByLabelText('Search full assigned workload') as HTMLInputElement).value).toBe('unapplied private draft'); expect(screen.queryByRole('button',{name:'Return to prior applied workload search'})).toBeNull(); expect(apiClient.patch).not.toHaveBeenCalled();
});
it('clears the prior drilldown return when new workload filters are explicitly applied', async () => {
  get.mockImplementation(async (_url,config)=>{const p=config?.params as Record<string,unknown>;return {data:{...result(Number(p.page)),filter_date:p.today,investigation_id:p.investigation_id,by_investigation:[{case_id:7,total:201,open:201,completed:0,without_due_date:0}],investigation_groups_total:1,investigation_group_limit:50}};});
  show();await screen.findByText(/201 matching assigned task records/);fireEvent.click(screen.getByText('Matching assigned workload by investigation'));fireEvent.click(screen.getByRole('button',{name:'Explore matching tasks in investigation #7'}));await screen.findByText(/Applied investigation #7 only/);
  fireEvent.change(screen.getByLabelText('Search full assigned workload'),{target:{value:'new applied'}});fireEvent.click(screen.getByRole('button',{name:'Apply full workload filters'}));await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({query:'new applied',investigation_id:7,page:1})}));expect(screen.queryByRole('button',{name:'Return to prior applied workload search'})).toBeNull();
});

it.each([['open','Explore 25 open tasks in investigation #7',{completion:'open',due:'all'}],['completed','Explore 5 completed tasks in investigation #7',{completion:'completed',due:'all'}],['undated','Explore 3 tasks without due date in investigation #7',{completion:'all',due:'none'}]])('narrows the exact %s investigation count from applied criteria and retains drafts/return',async (_subset,label,expected)=>{
 get.mockImplementation(async (_url,config)=>{const p=config?.params as Record<string,unknown>;const completed=p.completion==='completed';return {data:{data:[{...task,done:completed}],total:30,page:Number(p.page),size:25,filter_date:p.today,completion:p.completion,investigations:p.investigations,investigation_id:p.investigation_id,by_investigation:[{case_id:7,total:30,open:25,completed:5,without_due_date:3}],investigation_groups_total:1,investigation_group_limit:50}};});
 show();await screen.findByText(/30 matching assigned task records/);fireEvent.change(screen.getByLabelText('Full workload completion'),{target:{value:'all'}});fireEvent.click(screen.getByRole('button',{name:'Apply full workload filters'}));await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({completion:'all'})}));await screen.findByText(/30 matching assigned task records/);
 fireEvent.change(screen.getByLabelText('Search full assigned workload'),{target:{value:'private unapplied'}});fireEvent.click(screen.getByText('Matching assigned workload by investigation'));fireEvent.click(screen.getByRole('button',{name:label}));await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({...expected,investigation_id:7,page:1,query:''})}));
 expect((screen.getByLabelText('Search full assigned workload') as HTMLInputElement).value).toBe('private unapplied');fireEvent.click(screen.getByRole('button',{name:'Return to prior applied workload search'}));await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({completion:'all',due:'all',page:1,query:''})}));expect(get.mock.calls.at(-1)?.[1]?.params).not.toHaveProperty('investigation_id');expect(apiClient.patch).not.toHaveBeenCalled();
});

it.each([['Explore 25 matching open tasks',{completion:'open',due:'all'}],['Explore 5 matching completed tasks',{completion:'completed',due:'all'}],['Explore 3 matching tasks without due date',{completion:'all',due:'none'}]])('explores full matching summary count %s from applied criteria rather than the page sample or draft',async (label,expected)=>{
 get.mockImplementation(async (_url,config)=>{const p=config?.params as Record<string,unknown>;return {data:{data:[{...task,done:p.completion==='completed'}],total:30,page:Number(p.page),size:25,filter_date:p.today,completion:p.completion,investigations:p.investigations,summary:{total:30,investigations:2,open:p.completion==='completed'?0:p.completion==='open'?30:25,completed:p.completion==='completed'?30:p.completion==='open'?0:5,without_due_date:3,completed_without_timestamp:0}}};});
 show();await screen.findByText(/30 matching assigned task records/);fireEvent.change(screen.getByLabelText('Full workload completion'),{target:{value:'all'}});fireEvent.click(screen.getByRole('button',{name:'Apply full workload filters'}));await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({completion:'all'})}));await screen.findByRole('button',{name:label});fireEvent.click(screen.getByRole('button',{name:'Next workload page'}));await screen.findByText(/Page 2 of 2/);fireEvent.change(screen.getByLabelText('Search full assigned workload'),{target:{value:'unapplied'}});fireEvent.click(screen.getByRole('button',{name:label}));
 await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({...expected,page:1,query:''})}));expect((screen.getByLabelText('Search full assigned workload') as HTMLInputElement).value).toBe('unapplied');fireEvent.click(screen.getByRole('button',{name:'Return to prior applied workload search'}));await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/cases/assigned-task-explorer',{params:expect.objectContaining({completion:'all',due:'all',page:2,query:''})}));expect(apiClient.patch).not.toHaveBeenCalled();
});
it('does not invent count drilldowns from missing or invalid full matching summary',async()=>{show();await screen.findByText(/201 matching assigned task records/);expect(screen.queryByLabelText('Explore matching workload counts')).toBeNull();});
