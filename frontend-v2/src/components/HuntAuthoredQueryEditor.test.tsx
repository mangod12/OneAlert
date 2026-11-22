import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { HuntAuthoredQueryEditor } from './HuntAuthoredQueryEditor';
import { HuntQueryDraftWorkflow } from './HuntQueryDraftWorkflow';
import { draftSourceFixture } from '../utils/huntDraftSourceComparison.fixture';
import { parseAuthoredHuntDraft, parseHuntQueryDraft, type HuntAuthoredQuery } from '../utils/huntQueryDraft';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const post = vi.mocked(apiClient.post), sql = 'SELECT id FROM security_events WHERE user_id = :user_id ORDER BY id ASC LIMIT 100';
const submitted = (): HuntAuthoredQuery[] => [{ position: 1, description: '', sql, params: {} }];
const authored = (queries = submitted()) => {
  const { source } = draftSourceFixture(); source.session_id = 8; source.agent_run_id = 10; source.fingerprint = 'b'.repeat(64);
  Object.assign(source.draft, { generation_method: 'analyst_authored', explanation: null, explanation_shortened: false, generated_query_count: queries.length, omitted_query_count: 0 });
  source.draft.queries = queries.map(query => ({ ...structuredClone(source.draft.queries[0]), ...query, time_window: {} }));
  return source;
};
const show = () => { const callbacks = { onCancel: vi.fn(), onSaved: vi.fn(), onRecorded: vi.fn() }; const view = render(<HuntAuthoredQueryEditor hypothesis={draftSourceFixture().source.hypothesis} {...callbacks} />); return { ...callbacks, ...view }; };
const fill = () => fireEvent.change(screen.getByRole('textbox', { name: 'SQL for authored query 1' }), { target: { value: sql } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save analyst query draft' }));
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
it('saves exact analyst input on demand with no initial request, provider or execution endpoint', async () => {
  const callbacks = show(); expect(post).not.toHaveBeenCalled(); fill(); post.mockResolvedValueOnce({ data: { success: true, data: authored() } }); save();
  await vi.waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith(authored()));
  expect(post).toHaveBeenCalledExactlyOnceWith('/hunt/query-drafts/authored', { hypothesis: draftSourceFixture().source.hypothesis, queries: submitted() }); expect(callbacks.onRecorded).toHaveBeenCalledTimes(1);
});
it.each(['{', '[]', '{"user_id":"2"}', '{"keyword":1}', '{"keyword":""}'])('rejects invalid or owner-supplied parameters without a request: %s', async value => {
  show(); fill(); fireEvent.change(screen.getByRole('textbox', { name: 'Parameters JSON for authored query 1' }), { target: { value } }); save(); await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled();
});
it.each(['', ' ', 'X'.repeat(12001)])('refuses blank or oversized SQL before saving', async value => {
  show(); fireEvent.change(screen.getByRole('textbox', { name: 'SQL for authored query 1' }), { target: { value } }); save(); await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled();
});
it('allows at most three queries and renumbers retained input after an explicit removal', async () => {
  show(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Add authored query' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'SQL for authored query 2' }), { target: { value: sql } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Description for authored query 2' }), { target: { value: 'Retained second query' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add authored query' })); expect((screen.getByRole('button', { name: 'Add authored query' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove authored query 1' }));
  expect((screen.getByRole('textbox', { name: 'Description for authored query 1' }) as HTMLInputElement).value).toBe('Retained second query');
  fireEvent.click(screen.getByRole('button', { name: 'Remove authored query 2' }));
  const queries = [{ position: 1, description: 'Retained second query', sql, params: {} }]; post.mockResolvedValueOnce({ data: { success: true, data: authored(queries) } }); save();
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/hunt/query-drafts/authored', { hypothesis: draftSourceFixture().source.hypothesis, queries }));
});
it('blocks duplicate saves, cancellation and editing while a request is in flight', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); show(); fill(); save(); save(); expect(post).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: 'Cancel authored draft' }) as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole('textbox', { name: 'SQL for authored query 1' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  await act(async () => finish({ data: { success: true, data: authored() } }));
});
it('blocks unknown save retries and directs history inspection without claiming an event query ran', async () => {
  post.mockRejectedValueOnce(Error('Network interrupted')); const callbacks = show(); fill(); save(); await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('draft may already exist'); expect(screen.getByRole('alert').textContent).toContain('No event execution was requested'); expect((screen.getByRole('button', { name: 'Save analyst query draft' }) as HTMLButtonElement).disabled).toBe(true); expect(callbacks.onRecorded).toHaveBeenCalledTimes(1);
});
it('allows input correction after schema refusal without inventing a saved draft', async () => {
  post.mockRejectedValueOnce({ response: { status: 422 } }); const callbacks = show(); fill(); save(); await screen.findByRole('alert'); expect(callbacks.onSaved).not.toHaveBeenCalled(); expect(callbacks.onRecorded).not.toHaveBeenCalled(); expect((screen.getByRole('button', { name: 'Save analyst query draft' }) as HTMLButtonElement).disabled).toBe(false);
});
it('does not apply a delayed save after unmount', async () => {
  let finish!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const callbacks = show(); fill(); save(); callbacks.unmount(); await act(async () => finish({ data: { success: true, data: authored() } })); expect(callbacks.onSaved).not.toHaveBeenCalled(); expect(callbacks.onRecorded).not.toHaveBeenCalled();
});
it('checks exact authored source input, method, counts, narrative and absence of invented lineage', () => {
  expect(parseAuthoredHuntDraft(authored(), draftSourceFixture().source.hypothesis, submitted())).toEqual(authored());
  for (const mode of ['sql', 'params', 'description', 'method', 'count', 'explanation', 'run', 'lineage']) {
    const value = authored();
    if (mode === 'sql') value.draft.queries[0].sql += ' ';
    if (mode === 'params') value.draft.queries[0].params = { keyword: 'Not submitted' };
    if (mode === 'description') value.draft.queries[0].description = 'Different';
    if (mode === 'method') value.draft.generation_method = 'provider_response';
    if (mode === 'count') { value.draft.generated_query_count++; value.draft.omitted_query_count++; }
    if (mode === 'explanation') value.draft.explanation = 'Invented conclusion';
    if (mode === 'run') value.agent_run_id = null;
    if (mode === 'lineage') value.draft.refinement = draftSourceFixture().refined.draft.refinement;
    expect(() => parseAuthoredHuntDraft(value, draftSourceFixture().source.hypothesis, submitted())).toThrow();
  }
});
it('clears prior selection and locks generation while authoring, then requires fresh query selection after save', async () => {
  const { source } = draftSourceFixture(), onBusyChange = vi.fn(), onExecuted = vi.fn();
  post.mockResolvedValueOnce({ data: { success: true, data: source } });
  render(<HuntQueryDraftWorkflow hypothesis={source.hypothesis} disabled={false} onBusyChange={onBusyChange} onSaved={vi.fn()} onExecuted={onExecuted} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate query draft only' })); fireEvent.click(await screen.findByRole('checkbox', { name: 'Select original draft query 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Write query draft without AI' })); expect(onBusyChange).toHaveBeenLastCalledWith(true); expect(screen.queryByRole('checkbox')).toBeNull(); expect((screen.getByRole('button', { name: 'Generate query draft only' }) as HTMLButtonElement).disabled).toBe(true);
  fill(); post.mockResolvedValueOnce({ data: { success: true, data: authored() } }); save();
  const checkbox = await screen.findByRole('checkbox', { name: 'Select original draft query 1' }); expect((checkbox as HTMLInputElement).checked).toBe(false); expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(onExecuted).not.toHaveBeenCalled(); expect(screen.getByText(/Analyst authored, no AI call/)).toBeTruthy();
});
it('rejects unsupported saved generation methods instead of treating them as authored', () => { const value = authored(); value.draft.generation_method = 'unknown_analyst'; expect(() => parseHuntQueryDraft(value)).toThrow(); });
