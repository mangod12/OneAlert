import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { HuntLabRoute } from './HuntLab';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const source = { id: 7, title: '<b>Gateway authentication review</b>', summary: 'Unverified case observations', severity: 'high', status: 'investigating', user_id: 999 };
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => ({ data: String(url).startsWith('/cases/') ? source : String(url).endsWith('/detections') ? [] : { sessions: [], total: 0 } })); });
afterEach(cleanup);
const show = (query = 'source_case=7') => render(<MemoryRouter initialEntries={[`/app/hunt?${query}`]}><HuntLabRoute /><Link to="/app/hunt?source_case=8">Next source case</Link><Link to="/app/hunt?source_case=0">Invalid source case</Link></MemoryRouter>);
const read = () => fireEvent.click(screen.getByRole('button', { name: 'Read case metadata for a hypothesis draft' }));
it('does not read the case, change a draft or start a hunt until the separate explicit steps', async () => {
  show(); await screen.findByText('No hunts yet'); expect(get.mock.calls.some(([url]) => String(url).startsWith('/cases/'))).toBe(false);
  expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toBe(''); read();
  const review = await screen.findByLabelText('Case hypothesis review draft'); expect((review as HTMLTextAreaElement).value).toContain('"case_id": 7');
  expect(get).toHaveBeenCalledWith('/cases/7'); expect(screen.getByText(/Case visibility does not expand query access/)).toBeTruthy();
  expect(review.querySelector('b')).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.change(review, { target: { value: 'Reviewer-edited authentication inquiry' } }); fireEvent.click(screen.getByRole('button', { name: 'Use reviewed case hypothesis draft' }));
  expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toBe('Reviewer-edited authentication inquiry'); expect(apiClient.post).not.toHaveBeenCalled();
  vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { data: { explanation: 'Explicit hunt result' } } }); fireEvent.click(screen.getByRole('button', { name: 'Hunt' })); await screen.findByText('Explicit hunt result');
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/hunt/', { hypothesis: 'Reviewer-edited authentication inquiry' });
});
it('requires a separate checked replacement before overwriting an existing local draft', async () => {
  show(); fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'Keep my unsent draft' } }); read(); await screen.findByLabelText('Case hypothesis review draft');
  const use = screen.getByRole('button', { name: 'Use reviewed case hypothesis draft' }); expect((use as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(use); expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toBe('Keep my unsent draft');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Replace the current hypothesis draft with this reviewed text' })); fireEvent.click(use);
  expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toContain('"case_id": 7');
  expect((screen.getByRole('checkbox', { name: /Replace the current/ }) as HTMLInputElement).checked).toBe(false);
});
it.each(['source_case=0', 'source_case=7&source_case=8', 'source_case=1.5', 'source_case=8e0', 'source_case=2147483648', 'source_case=', 'source_case=-1'])('rejects ambiguous or invalid source route without a case read: %s', async query => {
  show(query); await screen.findByText(/Invalid source investigation link/); expect(screen.queryByLabelText('Case hypothesis review draft')).toBeNull(); expect(get.mock.calls.some(([url]) => String(url).startsWith('/cases/'))).toBe(false);
});
it('rejects a mismatched case and permits retry while preserving the hypothesis', async () => {
  get.mockImplementation(async url => ({ data: String(url).startsWith('/cases/') ? { ...source, id: 8 } : String(url).endsWith('/detections') ? [] : { sessions: [], total: 0 } }));
  show(); fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'Private unsent hypothesis' } }); read(); await screen.findByRole('alert');
  expect(screen.queryByLabelText('Case hypothesis review draft')).toBeNull(); expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toBe('Private unsent hypothesis');
  get.mockResolvedValueOnce({ data: source }); read(); await screen.findByLabelText('Case hypothesis review draft');
});
it('drops an old source reply on route changes, while keeping the analyst draft', async () => {
  let finish!: (value: unknown) => void;
  show(); fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'Keep this draft' } }); get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); read();
  fireEvent.click(screen.getByRole('link', { name: 'Next source case' })); await screen.findByText('Prepare a hunt from investigation #8');
  await act(async () => finish({ data: source })); expect(screen.queryByLabelText('Case hypothesis review draft')).toBeNull();
  expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toBe('Keep this draft');
});
it('rejects blank or oversized reviewed text and clears only handoff state on close', async () => {
  show('source_case=7&rule=99'); read(); const review = await screen.findByLabelText('Case hypothesis review draft');
  fireEvent.change(review, { target: { value: '😀'.repeat(4001) } }); expect((screen.getByRole('button', { name: 'Use reviewed case hypothesis draft' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(review, { target: { value: ' ' } }); expect((screen.getByRole('button', { name: 'Use reviewed case hypothesis draft' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'Retain independent draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Close case-to-hunt handoff' }));
  expect(screen.queryByLabelText('Case hypothesis review draft')).toBeNull(); expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toBe('Retain independent draft'); expect(apiClient.post).not.toHaveBeenCalled();
});
it('keeps an unavailable source unavailable without inferring an empty or authorized hunt', async () => {
  show(); get.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Investigation not found' } } }); read(); await screen.findByRole('alert'); expect(screen.queryByLabelText('Case hypothesis review draft')).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled();
});

it('blocks applying case text during an active hunt even after replacement is checked', async () => {
  show(); await screen.findByText('No hunts yet'); read(); await screen.findByLabelText('Case hypothesis review draft');
  fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'Running hypothesis' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Replace the current/ }));
  let finish!: (value: unknown) => void; vi.mocked(apiClient.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Hunt' })); expect((screen.getByRole('button', { name: 'Use reviewed case hypothesis draft' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use reviewed case hypothesis draft' })); expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value).toBe('Running hypothesis');
  await act(async () => finish({ data: { data: {} } }));
});
it('drops a pending source read when the source link becomes invalid', async () => {
  show(); await screen.findByText('No hunts yet'); let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); read();
  fireEvent.click(screen.getByRole('link', { name: 'Invalid source case' })); await screen.findByText(/Invalid source investigation link/); await act(async () => finish({ data: source }));
  expect(screen.queryByLabelText('Case hypothesis review draft')).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled();
});
