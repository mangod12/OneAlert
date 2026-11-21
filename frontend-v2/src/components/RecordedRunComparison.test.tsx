import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { saveHuntDownload } from '../utils/huntEvidence';
import { RecordedRunComparison } from './RecordedRunComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const step = (id: number, action = 'search') => ({ id, step_number: id, action, tool_used: null, input_summary: 'input', output_summary: 'output', duration_ms: 0 });
const run = (id: number, extra = {}) => ({ id, agent_type: id === 1 ? 'hunt' : 'triage', status: 'failed', started_at: '2026-11-22T00:00:00Z', completed_at: null, model_used: null, prompt_tokens: id === 1 ? 0 : 7, completion_tokens: 0, result_summary: '', error_message: 'saved failure', steps: [step(id * 10), step(id * 10 + 1)], ...extra });
function Wrapper() { const [selection, onSelection] = useState({ baseline: '', candidate: '' }); return <RecordedRunComparison selection={selection} onSelection={onSelection} />; }
function select(baseline = '1', candidate = '2') { fireEvent.change(screen.getByLabelText('Baseline run ID'), { target: { value: baseline } }); fireEvent.change(screen.getByLabelText('Candidate run ID'), { target: { value: candidate } }); }
async function load() { select(); fireEvent.click(screen.getByRole('button', { name: 'Read both selected runs' })); await screen.findByText(/2 shared occurrences/); }
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockImplementation(async url => ({ data: run(Number(String(url).split('/').at(-1))) })); });
afterEach(cleanup);
it('does not read on selection and rejects invalid or identical IDs', () => {
  render(<Wrapper />); select('1', '1'); expect(screen.getByText('Choose two different recorded runs.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Read both selected runs' })).toBeDisabled();
  for (const value of ['0', '-1', '1.5', '1e2', '01', '9007199254740992']) { select('1', value); expect(screen.getByRole('button', { name: 'Read both selected runs' })).toBeDisabled(); }
  select(); expect(get).not.toHaveBeenCalled();
});
it('reads only the two explicit owner endpoints, counts duplicates, shows caveats and zero tokens', async () => {
  render(<Wrapper />); await load(); expect(get.mock.calls.map(call => call[0])).toEqual(['/cases/agents/runs/1', '/cases/agents/runs/2']);
  expect(screen.getByText(/2 shared occurrences · 0 baseline-only occurrences · 0 candidate-only/)).toBeInTheDocument();
  expect(screen.getByText(/different recorded agent types/)).toBeInTheDocument(); expect(screen.getByText(/7 prompt tokens; 0 completion tokens/)).toBeInTheDocument(); expect(screen.getAllByText('(unknown elapsed interval)')).toHaveLength(2);
});
it('clears the prior pair immediately when either selected ID changes without reading again', async () => {
  render(<Wrapper />); await load(); fireEvent.change(screen.getByLabelText('Candidate run ID'), { target: { value: '3' } });
  expect(screen.queryByText(/2 shared occurrences/)).not.toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(2);
});
it('clears both selections and in-flight or loaded evidence', async () => {
  render(<Wrapper />); await load(); fireEvent.click(screen.getByRole('button', { name: 'Clear run comparison' }));
  expect(screen.getByLabelText('Baseline run ID')).toHaveValue(''); expect(screen.getByLabelText('Candidate run ID')).toHaveValue(''); expect(screen.queryByText(/2 shared occurrences/)).not.toBeInTheDocument();
});
it('refuses a partial comparison when one owner read is unavailable and retries the whole pair', async () => {
  get.mockRejectedValueOnce(new Error('denied')); render(<Wrapper />); select(); fireEvent.click(screen.getByRole('button', { name: 'Read both selected runs' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No partial comparison'); expect(screen.queryByText(/shared occurrences ·/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Read both selected runs' })); await screen.findByText(/2 shared occurrences/); expect(get).toHaveBeenCalledTimes(4);
});
it.each([{ id: 99 }, { steps: null }, { steps: [step(1), step(1)] }, { prompt_tokens: null }])('rejects malformed run source %#', async extra => {
  get.mockResolvedValueOnce({ data: run(1, extra) }); render(<Wrapper />); select(); fireEvent.click(screen.getByRole('button', { name: 'Read both selected runs' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('complete valid saved steps'); expect(screen.queryByText(/shared occurrences ·/)).not.toBeInTheDocument();
});
it('ignores late pair completion after a new selection', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); render(<Wrapper />); select(); fireEvent.click(screen.getByRole('button', { name: 'Read both selected runs' }));
  fireEvent.change(screen.getByLabelText('Candidate run ID'), { target: { value: '3' } });
  await act(async () => { resolve({ data: run(1) }); }); expect(screen.queryByText(/shared occurrences ·/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Read both selected runs' })); await screen.findByText(/2 shared occurrences/); expect(screen.getByText('Candidate #3')).toBeInTheDocument();
});
it('pages content groups and filters locally while exporting both complete sources and all groups', async () => {
  get.mockImplementation(async url => { const id = Number(String(url).split('/').at(-1)); return { data: run(id, { steps: Array.from({ length: 22 }, (_, i) => step(id * 100 + i, `action-${i}`)) }) }; });
  render(<Wrapper />); select(); fireEvent.click(screen.getByRole('button', { name: 'Read both selected runs' })); await screen.findByText(/22 shared occurrences/);
  expect(screen.getAllByText(/Inspect exact saved text/)).toHaveLength(10); fireEvent.click(screen.getByRole('button', { name: 'More comparison groups' })); expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Run comparison step groups'), { target: { value: 'changed' } }); expect(screen.getByText(/No saved content groups/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Download loaded run comparison JSON' })); expect(save).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(save.mock.calls[0][0]); expect(payload.baseline.run.steps).toHaveLength(22); expect(payload.candidate.run.steps).toHaveLength(22); expect(payload.comparison.groups).toHaveLength(22); expect(payload.comparison.shared).toBe(22); expect(payload.baseline.read_at).toBeTruthy(); expect(payload.scope).toContain('not an atomic snapshot'); expect(get).toHaveBeenCalledTimes(2);
});
it('renders saved HTML as literal text, including failure text, without executing markup', async () => {
  get.mockResolvedValueOnce({ data: run(1, { error_message: '<img src=x onerror=alert(1)>', result_summary: '<script>alert(1)</script>' }) }); render(<Wrapper />); await load();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument(); expect(document.querySelector('script')).toBeNull(); expect(document.querySelector('img')).toBeNull();
});
it('keeps both sources intact if the local download fails', async () => {
  save.mockImplementation(() => { throw Error('failed'); }); render(<Wrapper />); await load(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded run comparison JSON' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be downloaded')); expect(screen.getByText(/2 shared occurrences/)).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(2);
});
