import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { parseHuntQueryDraft, parseRefinedHuntDraft } from '../utils/huntQueryDraft';
import { HuntQueryRefinementEditor } from './HuntQueryRefinementEditor';
import { HuntQueryDraftWorkflow } from './HuntQueryDraftWorkflow';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const post = vi.mocked(apiClient.post);
const sql = 'SELECT id FROM security_events WHERE user_id = :user_id ORDER BY id ASC LIMIT 100';
const editedSql = sql.replace('LIMIT 100', 'LIMIT 20');
const source = () => parseHuntQueryDraft({ session_id: 7, hypothesis: 'Inspect owned metadata', fingerprint: 'a'.repeat(64), agent_run_id: 9, read_at: '2026-11-22T03:10:00Z', can_execute: true, scope: 'Compiler only', draft: { format: 'onealert_hunt_query_draft_v1', prepared_at: '2026-11-22T03:00:00Z', expires_at: '2026-11-22T04:00:00Z', generation_method: 'provider_response', generated_query_count: 1, omitted_query_count: 0, explanation: null, explanation_shortened: false, scope: 'No event SELECT', queries: [{ position: 1, description: 'Recorded proposal', description_shortened: false, sql, params: {}, accepted: true, error: null, time_window: {}, execution: { contract: 'scoped_select_v1', selected_columns: ['id'], order_by: 'id', direction: 'ASC', row_limit: 100, requested_limit: 100, tie_breaker: null } }] } });
const edits = () => [{ position: 1, sql: editedSql, params: {} }];
const child = () => {
  const original = source();
  return { ...original, session_id: 8, agent_run_id: 10, fingerprint: 'b'.repeat(64), draft: { ...original.draft, generation_method: 'analyst_refinement', queries: [{ ...original.draft.queries[0], sql: editedSql, execution: { ...original.draft.queries[0].execution!, row_limit: 20, requested_limit: 20 } }], refinement: { source_session_id: 7, source_fingerprint: original.fingerprint, source_prepared_at: original.draft.prepared_at, source_omitted_query_count: 0, edited_query_numbers: [1], scope: 'Analyst edits, no execution' } } };
};
const show = () => {
  const callbacks = { onCancel: vi.fn(), onSaved: vi.fn(), onRecorded: vi.fn() };
  const view = render(<HuntQueryRefinementEditor source={source()} {...callbacks} />);
  return { ...callbacks, ...view };
};
const editSql = () => fireEvent.change(screen.getByRole('textbox', { name: 'SQL for original query 1' }), { target: { value: editedSql } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save edits as new query draft' }));
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);

it('saves exact explicit edits as a separate draft and never executes or calls a provider endpoint', async () => {
  const callbacks = show(); expect(post).not.toHaveBeenCalled(); editSql();
  post.mockResolvedValueOnce({ data: { success: true, data: child() } }); save();
  await vi.waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith(child()));
  expect(post).toHaveBeenCalledExactlyOnceWith('/hunt/query-drafts/7/refinements', { fingerprint: source().fingerprint, edits: edits() });
  expect(callbacks.onRecorded).toHaveBeenCalledTimes(1);
});
it('does not send unchanged edits', async () => {
  show(); save(); await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled();
});
it.each(['{', '[]', '{"keyword":3}', '{"unknown":"value"}', '{"keyword":""}'])('rejects invalid parameter JSON before any request: %s', async value => {
  show(); editSql(); fireEvent.change(screen.getByRole('textbox', { name: 'Parameters JSON for original query 1' }), { target: { value } }); save();
  await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled();
});
it('rejects oversized or blank SQL without a request', async () => {
  show(); fireEvent.change(screen.getByRole('textbox', { name: 'SQL for original query 1' }), { target: { value: 'X'.repeat(12001) } }); save();
  await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled();
});
it('blocks duplicate save clicks and cancellation while the compiler-only request is in flight', async () => {
  let resolve!: (value: unknown) => void;
  post.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.post>);
  show(); editSql(); save(); save(); expect(post).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: 'Cancel edits' }) as HTMLButtonElement).disabled).toBe(true);
  resolve({ data: { success: true, data: child() } }); await screen.findByRole('button', { name: 'Save edits as new query draft' });
});
it('requires cancel and reload after a source conflict without silently rebasing or resubmitting', async () => {
  post.mockRejectedValueOnce({ response: { status: 409 } }); show(); editSql(); save(); await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: 'Save edits as new query draft' }) as HTMLButtonElement).disabled).toBe(true);
  expect(post).toHaveBeenCalledTimes(1);
});
it('keeps an unknown save outcome separate from event execution and blocks automatic retry', async () => {
  post.mockRejectedValueOnce(Error('network interrupted')); const callbacks = show(); editSql(); save(); await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('new draft may already exist');
  expect(screen.getByRole('alert').textContent).toContain('No event execution was requested');
  expect((screen.getByRole('button', { name: 'Save edits as new query draft' }) as HTMLButtonElement).disabled).toBe(true);
  expect(callbacks.onRecorded).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1);
});
it('does not apply a delayed save result after unmount', async () => {
  let resolve!: (value: unknown) => void;
  post.mockReturnValueOnce(new Promise(done => { resolve = done; }) as ReturnType<typeof apiClient.post>);
  const callbacks = show(); editSql(); save(); callbacks.unmount(); resolve({ data: { success: true, data: child() } });
  await Promise.resolve(); expect(callbacks.onSaved).not.toHaveBeenCalled(); expect(callbacks.onRecorded).not.toHaveBeenCalled();
});
it('validates both complete refinement provenance and the exact edited SQL before offering it', () => {
  expect(parseRefinedHuntDraft(child(), source(), edits())).toEqual(child());
  for (const patch of [{ source_session_id: 99 }, { source_fingerprint: 'c'.repeat(64) }, { source_prepared_at: '2026-11-21T03:00:00Z' }, { edited_query_numbers: [1, 1] }, { source_omitted_query_count: 2 }]) {
    const value = child(); Object.assign(value.draft.refinement, patch); expect(() => parseRefinedHuntDraft(value, source(), edits())).toThrow();
  }
  const wrongSql = child(); wrongSql.draft.queries[0].sql = sql; expect(() => parseRefinedHuntDraft(wrongSql, source(), edits())).toThrow();
  const missing = child(); delete (missing.draft as { refinement?: unknown }).refinement; expect(() => parseHuntQueryDraft(missing)).toThrow();
  const conflicting = child(); conflicting.draft.generation_method = 'provider_response'; expect(() => parseHuntQueryDraft(conflicting)).toThrow();
});
it('rejects invented refinement counts or an explanation that was not copied from the exact source', () => {
  const altered = child(); altered.draft.explanation = 'An unrelated new conclusion';
  expect(() => parseRefinedHuntDraft(altered, source(), edits())).toThrow();
  const counts = child(); counts.draft.generated_query_count = 2; counts.draft.omitted_query_count = 1;
  expect(() => parseHuntQueryDraft(counts)).toThrow();
  const original = source(); original.draft.explanation = 'E'.repeat(4000);
  const shortened = child(); shortened.draft.explanation = original.draft.explanation; shortened.draft.explanation_shortened = true;
  expect(() => parseRefinedHuntDraft(shortened, original, edits())).toThrow();
});

it('clears old selections, locks legacy actions while editing, and requires a new explicit selection after saving', async () => {
  const onBusyChange = vi.fn(), onExecuted = vi.fn();
  post.mockResolvedValueOnce({ data: { success: true, data: source() } });
  render(<HuntQueryDraftWorkflow hypothesis={source().hypothesis} disabled={false} onBusyChange={onBusyChange} onSaved={vi.fn()} onExecuted={onExecuted} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select original draft query 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refine SQL and parameters' }));
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Generate query draft only' }) as HTMLButtonElement).disabled).toBe(true);
  editSql(); post.mockResolvedValueOnce({ data: { success: true, data: child() } }); save();
  await screen.findByRole('heading', { name: 'Saved query draft #8' });
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('button', { name: 'Run 0 selected saved queries' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('link', { name: 'saved draft #7' }).getAttribute('href')).toBe('/app/hunt?query_draft=7');
  expect(onExecuted).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(2);
});
