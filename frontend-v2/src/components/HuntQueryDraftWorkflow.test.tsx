import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import * as evidence from '../utils/huntEvidence';
import { HuntQueryDraftWorkflow } from './HuntQueryDraftWorkflow';
import { parseHuntQueryDraft, parseReviewedHuntResult } from '../utils/huntQueryDraft';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const hypothesis = 'Inspect only owned event metadata', fingerprint = 'a'.repeat(64);
const fixture = () => ({ session_id: 7, hypothesis, fingerprint, agent_run_id: 9, read_at: '2026-11-22T03:10:00Z', can_execute: true, scope: 'Saved compiler review only.', draft: { format: 'onealert_hunt_query_draft_v1', prepared_at: '2026-11-22T03:00:00Z', expires_at: '2026-11-22T04:00:00Z', generation_method: 'provider_response', generated_query_count: 1, omitted_query_count: 0, explanation: null, explanation_shortened: false, scope: 'No event SELECT executed.', queries: [{ position: 1, description: 'Review owned metadata', description_shortened: false, sql: 'SELECT id FROM security_events WHERE user_id = :user_id ORDER BY id ASC LIMIT 100', params: {}, accepted: true, error: null, time_window: {}, execution: { contract: 'scoped_select_v1', selected_columns: ['id'], order_by: 'id', direction: 'ASC', row_limit: 100, requested_limit: 100, tie_breaker: null } }] } });
const completed = () => ({ session_id: 8, agent_run_id: 10, hypothesis, recorded_at: '2026-11-22T03:11:00Z', status: 'completed', sigma_rule: null, reviewed_draft: { session_id: 7, fingerprint, query_numbers: [1], scope: 'Selected saved queries only' }, execution_summary: { completed: 1, failed: 0, rejected: 0, attempted: 1, skipped: 0 }, query_results: [{ outcome: 'completed', query: { sql: fixture().draft.queries[0].sql, description: fixture().draft.queries[0].description, params: {}, reviewed_query_number: 1 }, row_count: 1, rows: [{ id: 221 }], execution: fixture().draft.queries[0].execution, time_window: {} }] });
const show = (onExecuted = vi.fn()) => render(<HuntQueryDraftWorkflow hypothesis={hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onExecuted={onExecuted} />);
beforeEach(() => { vi.clearAllMocks(); }); afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('query draft review', () => {
  it('does not read or generate on mount, then requires explicit query selection and a separate execution', async () => {
    const onExecuted = vi.fn(); show(onExecuted); expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
    post.mockResolvedValueOnce({ data: { success: true, data: fixture() } }); fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' }));
    const choice = await screen.findByRole('checkbox', { name: 'Select original draft query 1' }); expect(post).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Run 0 selected saved queries' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(choice); const result = completed();
    post.mockResolvedValueOnce({ data: { success: true, data: result } }); fireEvent.click(screen.getByRole('button', { name: 'Run 1 selected saved query' }));
    await vi.waitFor(() => expect(onExecuted).toHaveBeenCalledWith(result)); expect(post).toHaveBeenLastCalledWith('/hunt/query-drafts/7/execute', { fingerprint, query_numbers: [1] }); expect(get).not.toHaveBeenCalled();
  });
  it('never automatically retries an execution with an uncertain network outcome', async () => {
    post.mockResolvedValueOnce({ data: { success: true, data: fixture() } }); show(); fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select original draft query 1' })); post.mockRejectedValueOnce(Error('Network interrupted'));
    fireEvent.click(screen.getByRole('button', { name: 'Run 1 selected saved query' })); await screen.findByText(/Automatic retry is disabled/);
    expect(post).toHaveBeenCalledTimes(2); expect((screen.getByRole('button', { name: 'Generate query draft only' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('reopens exactly the requested saved draft without generating or executing', async () => {
    get.mockResolvedValueOnce({ data: fixture() }); render(<HuntQueryDraftWorkflow savedDraftId={7} hypothesis={hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onExecuted={vi.fn()} />);
    await screen.findByRole('checkbox', { name: 'Select original draft query 1' }); expect(get).toHaveBeenCalledWith('/hunt/query-drafts/7'); expect(post).not.toHaveBeenCalled();
  });
  it.each([{ fingerprint: 'bad' }, { session_id: 8 }, { can_execute: 'yes' }, { agent_run_id: -1 }])('rejects wrong-identity or malformed review data %o', patch => {
    expect(() => parseHuntQueryDraft({ ...fixture(), ...patch }, { id: 7 })).toThrow();
  });
  it('rejects incomplete compiler contracts instead of offering execution', () => {
    const value = fixture(); value.draft.queries[0].execution.row_limit = 101; expect(() => parseHuntQueryDraft(value)).toThrow();
    const other = fixture(); other.draft.queries[0].execution.selected_columns = ['raw_data']; expect(() => parseHuntQueryDraft(other)).toThrow();
  });
});

it('requires complete selected query results and counts, not only matching origin IDs', () => {
  const source = parseHuntQueryDraft(fixture());
  expect(parseReviewedHuntResult(completed(), source, [1])).toEqual(completed());
  for (const patch of [{ query_results: [] }, { execution_summary: undefined }, { status: 'partial' }, { sigma_rule: 'unrequested rule' }]) expect(() => parseReviewedHuntResult({ ...completed(), ...patch }, source, [1])).toThrow();
  const wrong = completed(); wrong.query_results[0].query.sql = 'SELECT other SQL'; expect(() => parseReviewedHuntResult(wrong, source, [1])).toThrow();
  const malformed = completed(); malformed.query_results[0].execution.row_limit = 99; expect(() => parseReviewedHuntResult(malformed, source, [1])).toThrow();
  const incomplete = completed(); incomplete.query_results[0].rows = []; expect(() => parseReviewedHuntResult(incomplete, source, [1])).toThrow();
});
it('keeps a source-linked terminal interruption separate from fabricated empty successful results', () => {
  const result = { session_id: 8, agent_run_id: 10, status: 'failed', error: 'Interrupted. Inspect the run; no complete result retained.', reviewed_draft: completed().reviewed_draft };
  expect(parseReviewedHuntResult(result, parseHuntQueryDraft(fixture()), [1])).toEqual(result);
});
it('forces an explicit saved-draft reload after refusal instead of resubmitting the old review', async () => {
  post.mockResolvedValueOnce({ data: { success: true, data: fixture() } }); show(); fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select original draft query 1' })); post.mockRejectedValueOnce({ response: { status: 409 } }); fireEvent.click(screen.getByRole('button', { name: 'Run 1 selected saved query' }));
  await screen.findByRole('alert'); expect((screen.getByRole('checkbox', { name: 'Select original draft query 1' }) as HTMLInputElement).disabled).toBe(true);
  get.mockResolvedValueOnce({ data: fixture() }); fireEvent.click(screen.getByRole('button', { name: 'Reload saved query draft' }));
  await vi.waitFor(() => expect((screen.getByRole('checkbox', { name: 'Select original draft query 1' }) as HTMLInputElement).disabled).toBe(false)); expect(post).toHaveBeenCalledTimes(2);
});

it('does not overwrite a changed hypothesis and prevents selecting an old plan for it', async () => {
  const callbacks = { onBusyChange: vi.fn(), onSaved: vi.fn(), onExecuted: vi.fn() };
  post.mockResolvedValueOnce({ data: { success: true, data: fixture() } });
  const view = render(<HuntQueryDraftWorkflow hypothesis={hypothesis} disabled={false} {...callbacks} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' })); await screen.findByRole('checkbox', { name: 'Select original draft query 1' });
  view.rerender(<HuntQueryDraftWorkflow hypothesis="A different unreviewed hypothesis" disabled={false} {...callbacks} />);
  expect((screen.getByRole('checkbox', { name: 'Select original draft query 1' }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/hypothesis input differs/)).toBeTruthy(); expect(post).toHaveBeenCalledTimes(1);
});
it('does not apply a generation result or callbacks after this review unmounts', async () => {
  let resolve!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.post>);
  const onSaved = vi.fn(), onExecuted = vi.fn(); const view = render(<HuntQueryDraftWorkflow hypothesis={hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={onSaved} onExecuted={onExecuted} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' })); view.unmount(); resolve({ data: { success: true, data: fixture() } });
  await Promise.resolve(); expect(onSaved).not.toHaveBeenCalled(); expect(onExecuted).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1);
});
it('rejects a wrong saved draft ID without replacing the requested source or executing', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture(), session_id: 8 } });
  render(<HuntQueryDraftWorkflow savedDraftId={7} hypothesis={hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onExecuted={vi.fn()} />);
  await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it('keeps an expired draft visible but disables all execution selections', async () => {
  const data = fixture(); data.can_execute = false; get.mockResolvedValueOnce({ data });
  render(<HuntQueryDraftWorkflow savedDraftId={7} hypothesis={hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onExecuted={vi.fn()} />);
  expect((await screen.findByRole('checkbox', { name: 'Select original draft query 1' }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/cannot currently be executed/)).toBeTruthy(); expect(post).not.toHaveBeenCalled();
});
it('refreshes history and preserves uncertainty instead of telling the user to retry a possibly completed execution', async () => {
  const onSaved = vi.fn(); post.mockResolvedValueOnce({ data: { success: true, data: fixture() } });
  render(<HuntQueryDraftWorkflow hypothesis={hypothesis} disabled={false} onBusyChange={vi.fn()} onSaved={onSaved} onExecuted={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' })); fireEvent.click(await screen.findByRole('checkbox', { name: 'Select original draft query 1' }));
  post.mockRejectedValueOnce({ code: 'ERR_NETWORK', message: 'Check connection and try again' }); fireEvent.click(screen.getByRole('button', { name: 'Run 1 selected saved query' }));
  await screen.findByRole('alert'); expect(onSaved).toHaveBeenCalledTimes(2); expect(screen.getByRole('alert').textContent).toContain('may have run'); expect(screen.getByRole('alert').textContent).not.toContain('try again');
});
it('blocks duplicate generation clicks synchronously before React rerenders', async () => {
  let resolve!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.post>); show();
  const button = screen.getByRole('button', { name: 'Generate query draft only' }); fireEvent.click(button); fireEvent.click(button); expect(post).toHaveBeenCalledTimes(1);
  resolve({ data: { success: true, data: fixture() } }); await screen.findByRole('checkbox');
});
it('accepts a complete failed query receipt while rejecting false successful counts or extra result fields', () => {
  const source = parseHuntQueryDraft(fixture()), result = completed();
  const failed = { ...result, status: 'failed', execution_summary: { completed: 0, rejected: 0, failed: 1, attempted: 1, skipped: 0 }, query_results: [{ query: result.query_results[0].query, outcome: 'failed', rows: [], error: 'Database request failed' }] };
  expect(parseReviewedHuntResult(failed, source, [1])).toEqual(failed);
  expect(() => parseReviewedHuntResult({ ...failed, status: 'completed' }, source, [1])).toThrow();
  const extra = completed(); extra.query_results[0].rows = [{ id: 221, raw_data: 'unsupported' } as { id: number }]; expect(() => parseReviewedHuntResult(extra, source, [1])).toThrow();
});

it('downloads only the loaded draft, warns about sensitive metadata and handles download failure without another request', async () => {
  const save = vi.spyOn(evidence, 'saveHuntDownload').mockImplementation(() => {}); post.mockResolvedValueOnce({ data: { success: true, data: fixture() } }); show();
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' })); await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('button', { name: 'Download loaded query draft JSON' }));
  const exported = JSON.parse(save.mock.calls[0][0]); expect(exported.draft.queries).toEqual(fixture().draft.queries); expect(exported.download_scope).toContain('Keep private'); expect(exported.query_results).toBeUndefined(); expect(post).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled();
  save.mockImplementation(() => { throw Error('Download blocked'); }); fireEvent.click(screen.getByRole('button', { name: 'Download loaded query draft JSON' })); await screen.findByText(/could not be downloaded/); expect(screen.getByRole('checkbox')).toBeTruthy();
});
