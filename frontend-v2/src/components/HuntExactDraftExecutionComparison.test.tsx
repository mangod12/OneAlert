import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import * as evidence from '../utils/huntEvidence';
import { exactDraftExecutionFixture } from '../utils/exactDraftExecutionComparison.fixture';
import { HuntExactDraftExecutionComparison } from './HuntExactDraftExecutionComparison';
import { HuntQueryDraftWorkflow } from './HuntQueryDraftWorkflow';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const show = (disabled = false) => {
  const fixture = exactDraftExecutionFixture();
  get.mockImplementation(async url => {
    if (url === '/hunt/81') return { data: fixture.left };
    if (url === '/hunt/82') return { data: fixture.right };
    throw Error('Unexpected exact record lookup');
  });
  return { ...fixture, ...render(<HuntExactDraftExecutionComparison source={fixture.source} disabled={disabled} />) };
};
const fill = (left = '81', right = '82') => {
  fireEvent.change(screen.getByLabelText('Exact-draft saved execution A ID'), { target: { value: left } });
  fireEvent.change(screen.getByLabelText('Exact-draft saved execution B ID'), { target: { value: right } });
};
const read = () => fireEvent.click(screen.getByRole('button', { name: 'Read exact saved executions for comparison' }));
const ready = () => screen.findByRole('link', { name: 'Inspect exact execution B #82' });
beforeEach(() => vi.resetAllMocks());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('reads exactly two saved records only on request, validates original positions and never runs a query', async () => {
  show(); expect(get).not.toHaveBeenCalled(); fill(); read(); await ready();
  expect(get.mock.calls.map(call => call[0])).toEqual(['/hunt/81', '/hunt/82']);
  expect(post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
  expect(screen.getByText(/1 shared exact rows; 0 only in A; 0 only in B/)).toBeTruthy();
  expect(screen.getByLabelText('Common completed original draft query').textContent).toBe('Original query 2');
  expect(screen.getByRole('link', { name: 'Inspect exact execution A #81' }).getAttribute('href')).toBe('/app/hunt?session=81');
  expect(screen.getByText(/not its latest live server version/)).toBeTruthy(); expect(screen.getByText(/not confirmed threats or a measured change/)).toBeTruthy();
});
it.each(['', '7', '81', '82.5', '8e1', '2147483648', '0082'])('refuses invalid, duplicate or source execution IDs locally: %s', async right => {
  show(); fill('81', right); read(); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it('clears a previous comparison before reading again and refuses mismatched source receipts without fallback', async () => {
  const { right } = show(); fill(); read(); await ready(); right.result_data.reviewed_draft!.fingerprint = 'b'.repeat(64);
  read(); expect(screen.queryByRole('link', { name: 'Inspect exact execution B #82' })).toBeNull(); await screen.findByRole('alert');
  expect(get.mock.calls.map(call => call[0])).toEqual(['/hunt/81', '/hunt/82', '/hunt/81', '/hunt/82']);
  expect(screen.queryByText(/shared exact rows/)).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('does not expose half a comparison or infer empty results when one exact owner read fails', async () => {
  show(); get.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Saved execution unavailable' } } }); fill(); read();
  await screen.findByRole('alert'); expect(get).toHaveBeenCalledTimes(2); expect(screen.queryByText(/shared exact rows/)).toBeNull();
});
it('invalidates a pending pair when either entered ID changes', async () => {
  let finish!: (value: unknown) => void; const fixture = show();
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); fill(); read();
  fireEvent.change(screen.getByLabelText('Exact-draft saved execution B ID'), { target: { value: '83' } });
  await act(async () => finish({ data: fixture.left })); expect(screen.queryByText(/shared exact rows/)).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
});
it.each(['fingerprint', 'id', 'read_time'])('clears entered IDs and ignores late reads when the loaded source changes: %s', async mode => {
  let finish!: (value: unknown) => void; const fixture = show(); get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); fill(); read();
  const next = structuredClone(fixture.source); if (mode === 'fingerprint') next.fingerprint = 'b'.repeat(64); if (mode === 'id') next.session_id = 8; if (mode === 'read_time') next.read_at = '2026-11-22T03:11:00Z';
  fixture.rerender(<HuntExactDraftExecutionComparison source={next} />); await act(async () => finish({ data: fixture.left }));
  expect((screen.getByLabelText('Exact-draft saved execution A ID') as HTMLInputElement).value).toBe(''); expect(screen.queryByText(/shared exact rows/)).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
});
it('blocks duplicate reads and ignores a late pair after close or unmount', async () => {
  let finish!: (value: unknown) => void; const fixture = show(); get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); fill(); read(); read(); expect(get).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Close exact execution comparison' })); await act(async () => finish({ data: fixture.left })); expect(screen.queryByText(/shared exact rows/)).toBeNull();
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); read(); fixture.unmount(); await act(async () => finish({ data: fixture.left })); expect(screen.queryByText(/shared exact rows/)).toBeNull();
});
it('does not read or allow input while conflicting parent work disables the panel', () => {
  show(true); read(); expect(get).not.toHaveBeenCalled(); expect((screen.getByLabelText('Exact-draft saved execution A ID') as HTMLInputElement).disabled).toBe(true);
});
it('paginates loaded retained values and changes row sets locally without another read', async () => {
  const { left, right } = show(); left.result_data.query_results![0].rows = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 })); left.result_data.query_results![0].row_count = left.findings_count = 23;
  right.result_data.query_results![0].rows = []; right.result_data.query_results![0].row_count = right.findings_count = 0;
  fill(); read(); await ready(); expect(screen.getByRole('list', { name: 'Exact draft execution compared rows' }).children).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: 'More exact compared rows' })); expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Exact execution comparison row set'), { target: { value: 'shared' } }); expect(screen.getByText('Page 1 of 1')).toBeTruthy(); expect(screen.getByText(/No retained rows in this selected set/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2);
});
it('switches common original positions without aligning by result-array index or reading again', async () => {
  const { source, left, right } = show();
  for (const saved of [left, right]) {
    const first = source.draft.queries[0]; saved.result_data.reviewed_draft!.query_numbers = [1, 2];
    saved.result_data.query_results!.unshift({ ...structuredClone(saved.result_data.query_results![0]), query: { description: first.description, sql: first.sql!, params: first.params, reviewed_query_number: 1 }, rows: [{ id: 1 }] });
    saved.result_data.execution_summary = { completed: 2, rejected: 0, failed: 0, attempted: 2, skipped: 0 }; saved.queries_run = saved.findings_count = 2;
  }
  fill(); read(); await ready(); expect(screen.getByLabelText('Common completed original draft query').children).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Common completed original draft query'), { target: { value: '2' } }); expect(get).toHaveBeenCalledTimes(2);
  expect((screen.getByLabelText('Common completed original draft query') as HTMLSelectElement).value).toBe('2');
});
it('downloads only the selected loaded query, handles local failures and does not fetch or execute again', async () => {
  const save = vi.spyOn(evidence, 'saveHuntDownload').mockImplementation(() => {}); show(); fill(); read(); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Download selected exact execution comparison JSON' })); const value = JSON.parse(save.mock.calls[0][0]); expect(value.selected_source_query.position).toBe(2); expect(value.left.result_data).toBeUndefined(); expect(value.retained_row_sets.shared).toEqual([{ id: 22 }]);
  expect(save.mock.calls[0][1]).toBe('hunt-draft-7-executions-81-vs-82-query-2.json'); expect(get).toHaveBeenCalledTimes(2); expect(post).not.toHaveBeenCalled();
  save.mockImplementationOnce(() => { throw Error('Local download unavailable'); }); fireEvent.click(screen.getByRole('button', { name: 'Download selected exact execution comparison JSON' })); await screen.findByRole('alert'); expect(screen.getByRole('link', { name: 'Inspect exact execution B #82' })).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText('Exact-draft saved execution B ID'), { target: { value: '83' } }); expect(screen.queryByRole('button', { name: 'Download selected exact execution comparison JSON' })).toBeNull();
});
it('keeps comparison available after an uncertain execution without enabling execution retry', async () => {
  const { source, left, right } = exactDraftExecutionFixture(); post.mockResolvedValueOnce({ data: { success: true, data: source } });
  get.mockImplementation(async url => ({ data: url === '/hunt/81' ? left : right }));
  render(<HuntQueryDraftWorkflow hypothesis={source.hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onExecuted={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' })); fireEvent.click(await screen.findByRole('checkbox', { name: 'Select original draft query 2' }));
  post.mockRejectedValueOnce(Error('Unknown execution outcome')); fireEvent.click(screen.getByRole('button', { name: 'Run 1 selected saved query' })); await screen.findByText(/Execution may already have run/);
  fill(); read(); await ready(); expect(post).toHaveBeenCalledTimes(2); expect(get).toHaveBeenCalledTimes(2);
  expect((screen.getByRole('button', { name: 'Run 0 selected saved queries' }) as HTMLButtonElement).disabled).toBe(true);
});
