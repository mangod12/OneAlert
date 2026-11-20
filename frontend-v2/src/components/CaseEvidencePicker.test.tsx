import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseEvidencePicker } from './CaseEvidencePicker';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const row = { id: 100, kind: 'alert', title: 'Old recorded exposure', severity: 'critical', detail: 'CVE-2099-0100', timestamp: '2026-01-01T00:00:00Z' };
const response = (data: unknown[] = [row], override = {}) => ({ data, total: 125, page: 1, size: 10, kind: 'alert', case_id: 7, ...override });
const linked = vi.fn(), cancel = vi.fn();
const mount = () => render(<CaseEvidencePicker caseId={7} kind="alert" onCancel={cancel} onLinked={linked} />);
const params = () => get.mock.calls.at(-1)?.[1]?.params as Record<string, unknown>;
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (_url, config) => ({ data: response([row], { page: (config?.params as {page?: number})?.page ?? 1 }) })); post.mockResolvedValue({ data: { success: true, data: { linked: true } } }); });
afterEach(cleanup);
it('searches complete evidence and links only the reviewed exact record to its displayed investigation', async () => {
  mount(); await screen.findByLabelText('Select alert #100'); expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Select alert #100')); expect(screen.getByText(/Destination: investigation #7/)).toBeTruthy(); expect(screen.getByText(/may raise investigation severity/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Link selected alert' })); await waitFor(() => expect(post).toHaveBeenCalledWith('/cases/7/alerts/100')); expect(linked).toHaveBeenCalledWith(true);
});
it('applies a trimmed draft on submit and clears selection when paging or filtering', async () => {
  mount(); await screen.findByLabelText('Select alert #100'); fireEvent.click(screen.getByLabelText('Select alert #100'));
  fireEvent.change(screen.getByLabelText('Search linkable alerts'), { target: { value: '  100%_literal  ' } }); expect(get).toHaveBeenCalledTimes(1); expect(screen.getByText(/Search draft not applied/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search evidence' })); await waitFor(() => expect(params()).toMatchObject({ page: 1, query: '100%_literal' })); await screen.findByLabelText('Select alert #100');
  expect((screen.getByRole('button', { name: 'Link selected alert' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Select alert #100')); fireEvent.click(screen.getByRole('button', { name: 'Next evidence page' })); await waitFor(() => expect(params().page).toBe(2)); await screen.findByLabelText('Select alert #100');
  expect((screen.getByLabelText('Select alert #100') as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('Candidate severity'), { target: { value: 'critical' } }); await waitFor(() => expect(params()).toMatchObject({ page: 1, severity: 'critical', query: '100%_literal' }));
});
it.each([{ case_id: 8 }, { kind: 'event' }, { page: 2 }, { size: 100 }, { data: [{ ...row, id: -1 }] }])('rejects mismatched candidate replies %j', async override => {
  get.mockResolvedValueOnce({ data: response([row], override) }); mount(); await screen.findByRole('alert'); expect(screen.queryByLabelText('Select alert #100')).toBeNull(); expect((screen.getByRole('button', { name: 'Link selected alert' }) as HTMLButtonElement).disabled).toBe(true);
});
it('does not turn read failure into a claim that every evidence record is already linked', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); mount(); await screen.findByRole('alert'); expect(screen.queryByText(/No linkable records match/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence candidates' })); await screen.findByLabelText('Select alert #100');
});
it('ignores superseded candidate replies and old selections cannot be submitted while loading', async () => {
  mount(); await screen.findByLabelText('Select alert #100'); fireEvent.click(screen.getByLabelText('Select alert #100'));
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(screen.getByRole('button', { name: 'Next evidence page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Link selected alert' })); expect(post).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('Candidate severity'), { target: { value: 'high' } }); await screen.findByLabelText('Select alert #100');
  await act(async () => { resolve({ data: response([{ ...row, id: 22, title: 'Old superseded response' }], { page: 2 }) }); }); expect(screen.queryByText('Old superseded response')).toBeNull();
});
it('blocks duplicate submits, Escape and cancel while one exact link write is pending', async () => {
  post.mockReturnValueOnce(new Promise(() => {})); mount(); await screen.findByLabelText('Select alert #100'); fireEvent.click(screen.getByLabelText('Select alert #100'));
  fireEvent.click(screen.getByRole('button', { name: 'Link selected alert' })); fireEvent.click(screen.getByRole('button', { name: 'Linking evidence...' })); fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(post).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled();
});
it('requires confirmed acknowledgement, clears selection and refreshes instead of blindly retrying a possible write', async () => {
  post.mockResolvedValueOnce({ data: { success: true } }); mount(); await screen.findByLabelText('Select alert #100'); fireEvent.click(screen.getByLabelText('Select alert #100')); fireEvent.click(screen.getByRole('button', { name: 'Link selected alert' }));
  await screen.findByText(/did not confirm whether the record was linked/); expect(linked).not.toHaveBeenCalled(); expect((screen.getByRole('button', { name: 'Link selected alert' }) as HTMLButtonElement).disabled).toBe(true);
  get.mockResolvedValueOnce({ data: response([], { total: 0 }) }); fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence candidates' })); await screen.findByText(/No linkable records match/);
});
it('reports already-linked acknowledgement distinctly and never notifies a new case after unmount', async () => {
  post.mockResolvedValueOnce({ data: { success: true, data: { linked: false } } }); const { unmount } = mount(); await screen.findByLabelText('Select alert #100'); fireEvent.click(screen.getByLabelText('Select alert #100')); fireEvent.click(screen.getByRole('button', { name: 'Link selected alert' })); await waitFor(() => expect(linked).toHaveBeenCalledWith(false)); unmount();
  linked.mockClear(); let resolve!: (value: unknown) => void; post.mockReturnValueOnce(new Promise(r => { resolve = r; })); const other = mount(); await screen.findByLabelText('Select alert #100'); fireEvent.click(screen.getByLabelText('Select alert #100')); fireEvent.click(screen.getByRole('button', { name: 'Link selected alert' })); other.unmount(); await act(async () => { resolve({ data: { success: true, data: { linked: true } } }); }); expect(linked).not.toHaveBeenCalled();
});
it('links an event only after showing the processed-state consequence', async () => {
  get.mockResolvedValueOnce({ data: response([{ ...row, kind: 'event', severity: null }], { kind: 'event' }) }); render(<CaseEvidencePicker caseId={7} kind="event" onCancel={cancel} onLinked={linked} />);
  await screen.findByLabelText('Select event #100'); expect(screen.getByText(/also marks that event/)).toBeTruthy(); expect(screen.getByText(/Severity not recorded/)).toBeTruthy(); fireEvent.click(screen.getByLabelText('Select event #100')); fireEvent.click(screen.getByRole('button', { name: 'Link selected event' })); await waitFor(() => expect(post).toHaveBeenCalledWith('/cases/7/events/100'));
});
