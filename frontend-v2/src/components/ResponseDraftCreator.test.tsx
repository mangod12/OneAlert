import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponseDraftCreator } from './ResponseDraftCreator';
vi.mock('../api/client', () => ({ default: { post: vi.fn() } }));
const post = vi.mocked(apiClient.post), created = vi.fn();
const result = { plan_id: 81, case_id: 7, status: 'draft', autonomy_level: 'L1', run_id: 33, action_count: 3, approved: false, execution_requested: false };
const view = () => render(<MemoryRouter><ResponseDraftCreator caseId={7} onCreated={created} /></MemoryRouter>);
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Review draft generation' }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Generate and save unapproved L1 draft' }));
beforeEach(() => { vi.resetAllMocks(); post.mockResolvedValue({ data: result }); });
afterEach(cleanup);
it('requires explicit scope review and saves only a fixed draft request with exact plan/run links', async () => {
  view(); expect(post).not.toHaveBeenCalled(); open(); expect(post).not.toHaveBeenCalled();
  expect(screen.getByText(/first 20 linked alert/)).toBeTruthy(); expect(screen.getByText(/Linked event records/)).toBeTruthy();
  expect(screen.getByText(/Targets can be placeholders/)).toBeTruthy(); save(); await screen.findByRole('status');
  expect(post).toHaveBeenCalledExactlyOnceWith('/response-plans/draft-from-case/7'); expect(created).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'Review saved draft #81' }).getAttribute('href')).toBe('/response-plans?plan=81');
  expect(screen.getByRole('link', { name: 'Inspect generation run #33' }).getAttribute('href')).toBe('/audit-log?run=33');
  expect(screen.getByText(/Not approved or executed/)).toBeTruthy();
});
it('cancel leaves no draft and sends no request', () => { view(); open(); fireEvent.click(screen.getByRole('button', { name: 'Cancel draft generation' })); expect(post).not.toHaveBeenCalled(); expect(screen.queryByText(/Targets can be/)).toBeNull(); });
it('blocks duplicate requests while one generation is running', async () => {
  let finish!: (value: unknown) => void; post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); view(); open(); save(); fireEvent.click(screen.getByRole('button', { name: 'Generating response draft...' })); expect(post).toHaveBeenCalledOnce();
  await act(async () => finish({ data: result })); await screen.findByRole('status');
});
it.each([{ case_id: 9 }, { status: 'approved' }, { autonomy_level: 'L4' }, { approved: true }, { execution_requested: true }, { plan_id: -1 }, { run_id: null }, { action_count: 101 }, { action_count: 0 }])('does not claim saved draft from mismatched receipt %j', async changes => {
  post.mockResolvedValueOnce({ data: { ...result, ...changes } }); view(); open(); save(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull(); expect(created).not.toHaveBeenCalled();
});
it('leaves uncertain failures visible and does not automatically retry a mutation', async () => {
  post.mockRejectedValueOnce(new Error('Offline')); view(); open(); save(); await screen.findByRole('alert'); expect(screen.getByText(/does not establish whether a draft was saved/)).toBeTruthy(); expect(post).toHaveBeenCalledOnce();
});
it('ignores a late reply after leaving the case', async () => {
  let finish!: (value: unknown) => void; post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const rendered = view(); open(); save(); rendered.unmount(); await act(async () => finish({ data: result })); expect(created).not.toHaveBeenCalled();
});

it('resets on a case switch and prevents a prior case reply from becoming current evidence', async () => {
  let finish!: (value: unknown) => void; post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const rendered = view(); open(); save(); rendered.rerender(<MemoryRouter><ResponseDraftCreator caseId={8} onCreated={created} /></MemoryRouter>);
  await act(async () => finish({ data: result })); expect(screen.queryByRole('link')).toBeNull(); expect(created).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Review draft generation' })).toBeTruthy();
});
