import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AgentStepSearch } from './AgentStepSearch';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('./AgentRunInspector', () => ({ AgentRunInspector: ({ runId, onClose }: { runId: number; onClose: () => void }) => <div role="dialog">Exact saved run {runId}<button onClick={onClose}>Close exact run</button></div> }));
const get = vi.mocked(apiClient.get), excerpt = { text: 'Literal 100%_needle <b>metadata</b>', shortened: true, recorded_length: 1800 };
const row = { step_id: 90, run_id: 7, step_number: 3, agent_type: 'hunt', run_status: 'failed', run_started_at: '2026-11-21T00:00:00Z', matched_fields: ['output_summary'], excerpts: { action: { text: 'validate', shortened: false, recorded_length: 8 }, tool_used: { text: null, shortened: false, recorded_length: null }, input_summary: { text: '', shortened: false, recorded_length: 0 }, output_summary: excerpt } };
const fixture = { query: 'needle', field: 'all', agent_type: '', run_status: '', page: 1, size: 10, total: 1, records: [row], retrieved_at: '2026-11-22T00:00:00Z', excerpt_limit: 500, scope: 'Saved owned summary search' };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); }); afterEach(cleanup);
const show = () => render(<AgentStepSearch />);
const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Find recorded step evidence across all owned runs' }));
const submit = (query = 'needle') => { fireEvent.change(screen.getByLabelText('Search all owned recorded steps'), { target: { value: query } }); fireEvent.click(screen.getByRole('button', { name: 'Search recorded step evidence' })); };
it('waits for explicit nonempty search and shows bounded literal excerpts with exact-run access only', async () => {
  show(); expect(get).not.toHaveBeenCalled(); expand(); expect(get).not.toHaveBeenCalled(); expect((screen.getByRole('button', { name: 'Search recorded step evidence' }) as HTMLButtonElement).disabled).toBe(true); submit();
  await screen.findByText('Run #7 · Step 3 · Record #90'); expect(get).toHaveBeenCalledExactlyOnceWith('/cases/agents/step-search', { params: { query: 'needle', field: 'all', agent_type: '', run_status: '', page: 1, size: 10 } });
  expect(screen.getByText(excerpt.text).querySelector('b')).toBeNull(); expect(screen.getByText(/shortened excerpt of 1800/)).toBeTruthy(); expect(screen.getByText('(not recorded)')).toBeTruthy(); expect(screen.getByText('(empty recorded text)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect exact run #7 for step record #90' })); expect(screen.getByRole('dialog').textContent).toContain('Exact saved run 7'); fireEvent.click(screen.getByRole('button', { name: 'Close exact run' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
});
it('submits field and exact run scope, preserving a dirty draft separately from applied results', async () => {
  show(); expand(); fireEvent.change(screen.getByLabelText('Cross-run step search field'), { target: { value: 'output_summary' } }); fireEvent.change(screen.getByLabelText('Exact recorded agent type'), { target: { value: ' hunt ' } }); fireEvent.change(screen.getByLabelText('Exact recorded run status'), { target: { value: 'failed' } });
  get.mockResolvedValueOnce({ data: { ...fixture, field: 'output_summary', agent_type: 'hunt', run_status: 'failed' } }); submit(' needle '); await screen.findByText('Run #7 · Step 3 · Record #90');
  expect(get).toHaveBeenLastCalledWith('/cases/agents/step-search', { params: { query: 'needle', field: 'output_summary', agent_type: 'hunt', run_status: 'failed', page: 1, size: 10 } });
  fireEvent.change(screen.getByLabelText('Search all owned recorded steps'), { target: { value: 'private draft' } }); expect(screen.getByText(/Search drafts are not applied/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(1); expect((screen.getByRole('button', { name: 'More step search matches' }) as HTMLButtonElement).disabled).toBe(true);
});
it.each([{ query: 'other' }, { field: 'input_summary' }, { total: 2 }, { page: 2 }, { excerpt_limit: 1000 }, { records: [{ ...row, matched_fields: ['raw_data'] }] }, { records: [{ ...row, excerpts: { ...row.excerpts, output_summary: { ...excerpt, text: 'a'.repeat(501) } } }] }, { records: [row, row] }])('fails closed on mismatched or malformed search results %j', changes => {
  get.mockResolvedValueOnce({ data: { ...fixture, ...changes } }); show(); expand(); submit(); return screen.findByRole('alert').then(() => { expect(screen.queryByText('Run #7 · Step 3 · Record #90')).toBeNull(); });
});
it('keeps no-match results distinct from failure and retries read errors', async () => {
  get.mockRejectedValueOnce(Error('Unavailable')); show(); expand(); submit(); await screen.findByRole('alert'); expect(screen.queryByText(/No saved owned-run/)).toBeNull();
  get.mockResolvedValueOnce({ data: { ...fixture, records: [], total: 0 } }); fireEvent.click(screen.getByRole('button', { name: 'Retry recorded step search' })); await screen.findByText(/No saved owned-run step summaries match/); expect(screen.getByText(/Missing matches do not establish/)).toBeTruthy();
});
it('paginates current matching steps and returns to a valid page after concurrent removals', async () => {
  const first = { ...fixture, total: 11, records: Array.from({ length: 10 }, (_, i) => ({ ...row, step_id: i + 1 })) }; get.mockResolvedValueOnce({ data: first }); show(); expand(); submit(); await screen.findByText('Run #7 · Step 3 · Record #1');
  get.mockResolvedValueOnce({ data: { ...first, page: 2, records: [row] } }); fireEvent.click(screen.getByRole('button', { name: 'More step search matches' })); await screen.findByText('Run #7 · Step 3 · Record #90');
  get.mockResolvedValueOnce({ data: { ...fixture, page: 2, total: 1, records: [] } }).mockResolvedValueOnce({ data: fixture }); fireEvent.click(screen.getByRole('button', { name: 'Refresh applied step search' })); await screen.findByText(/1 matching recorded steps · Page 1 of 1/);
});
it('invalidates an old reply on clearing, closing or a new submitted query', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); show(); expand(); submit();
  fireEvent.click(screen.getByRole('button', { name: 'Clear recorded step search' })); await act(async () => finish({ data: fixture })); expect(screen.queryByText(/Record #90/)).toBeNull();
  get.mockResolvedValueOnce({ data: { ...fixture, query: 'second' } }); submit('second'); await screen.findByText('Run #7 · Step 3 · Record #90');
  expand(); expect(screen.queryByText(/Record #90/)).toBeNull(); get.mockResolvedValueOnce({ data: { ...fixture, query: 'second' } }); expand(); await screen.findByText('Run #7 · Step 3 · Record #90');
});
