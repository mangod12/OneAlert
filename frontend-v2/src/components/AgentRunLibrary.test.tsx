import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AgentRunLibrary } from './AgentRunLibrary';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { id: 81, agent_type: 'triage', status: 'failed', started_at: '2026-11-20T00:00:00Z', completed_at: null, model_used: 'recorded-model', prompt_tokens: 50, completion_tokens: 10, result_summary: 'Historical gateway review' };
const data = (params: unknown) => ({ ...(params as object), total: 61, retrieved_at: '2026-11-21T00:00:00Z', agent_types: ['hunt', 'triage'], statuses: ['completed', 'failed'], models: ['recorded-model'], records: [row] });
async function show() { render(<AgentRunLibrary />); expect(get).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: /Explore all recorded agent runs/ })); await screen.findByText('Historical gateway review'); }
beforeEach(() => { get.mockReset(); get.mockImplementation(async (_url, options) => ({ data: data(options?.params) })); });
afterEach(cleanup);
it('loads only on demand and pages beyond fifty with total counts', async () => {
  await show(); expect(screen.getByText(/61 matching runs/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next run page' })); await screen.findByText(/Page 2 of 4/);
  expect(get).toHaveBeenLastCalledWith('/cases/agents/run-library', { params: { query: '', agent_type: '', run_status: '', model: '', page: 2, size: 20 } });
});
it('keeps drafts unapplied and applies exact combined scope from page one', async () => {
  await show(); fireEvent.click(screen.getByRole('button', { name: 'Next run page' })); await screen.findByText(/Page 2 of 4/);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' 100%_safe ' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Agent type' }), { target: { value: 'triage' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Recorded run status' }), { target: { value: 'failed' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Recorded model' }), { target: { value: 'recorded-model' } });
  expect(screen.getByRole('button', { name: 'Next run page' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply run library filters' }));
  await screen.findByText(/Page 1 of 4/);
  expect(get).toHaveBeenLastCalledWith('/cases/agents/run-library', { params: { query: '100%_safe', agent_type: 'triage', run_status: 'failed', model: 'recorded-model', page: 1, size: 20 } });
});
it('opens the exact owned inspector without running anything', async () => {
  await show(); get.mockResolvedValueOnce({ data: { ...row, error_message: 'Saved failure detail', steps: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect library run #81' }));
  expect(await screen.findByText('Saved failure detail')).toBeInTheDocument();
  expect(get).toHaveBeenLastCalledWith('/cases/agents/runs/81');
  fireEvent.click(screen.getByRole('button', { name: 'Close run' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('handles unavailable reads independently from no matching records and retries', async () => {
  render(<AgentRunLibrary />); get.mockRejectedValueOnce(new Error('Denied'));
  fireEvent.click(screen.getByRole('button', { name: /Explore all recorded agent runs/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No absence of runs or counts is inferred');
  fireEvent.click(screen.getByRole('button', { name: 'Retry run library' }));
  await screen.findByText('Historical gateway review');
});
it.each(['query', 'page', 'total', 'records', 'models'])('rejects mismatched %s', async field => {
  render(<AgentRunLibrary />);
  get.mockImplementation(async (_url, options) => ({ data: { ...data(options?.params), [field]: field === 'records' ? [{ ...row, id: -1 }] : 'wrong' } }));
  fireEvent.click(screen.getByRole('button', { name: /Explore all recorded agent runs/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('did not match');
  expect(screen.queryByText('Historical gateway review')).not.toBeInTheDocument();
});
it('ignores an old read after applying a newer filter', async () => {
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  render(<AgentRunLibrary />); fireEvent.click(screen.getByRole('button', { name: /Explore all recorded agent runs/ }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gateway' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply run library filters' }));
  await screen.findByText('Historical gateway review');
  resolve({ data: { ...data({ query: '', page: 1, size: 20, agent_type: '', run_status: '', model: '' }), records: [{ ...row, result_summary: 'Obsolete read' }] } });
  await waitFor(() => expect(screen.queryByText('Obsolete read')).not.toBeInTheDocument());
});
