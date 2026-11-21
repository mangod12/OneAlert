import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { saveHuntDownload } from '../utils/huntEvidence';
import { RecordedAgentHealth } from './RecordedAgentHealth';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const group = (agent_type: string, status: string, count = 10) => ({ agent_type, status, count, first_started_at: '2026-11-01T00:00:00Z', last_started_at: '2026-11-02T00:00:00Z' });
const data = (params: Record<string, unknown> = {}) => ({ from_date: params.from_date ?? null, before_date: params.before_date ?? null, agent_type: params.agent_type ?? '', retrieved_at: '2026-11-22T00:00:00Z', total: 70, groups: [group('hunt', 'failed', 30), group('hunt', 'running', 7), group('triage', 'completed', 33)], oldest_running: [{ id: 77, agent_type: 'hunt', started_at: '2026-11-01T00:00:00Z' }], scope: 'Owned recorded statuses, not liveness.' });
async function open() { render(<RecordedAgentHealth />); fireEvent.click(screen.getByRole('button', { name: 'Review recorded agent execution health' })); }
async function read() { fireEvent.click(screen.getByRole('button', { name: 'Read recorded execution health' })); await screen.findByText(/70 owned recorded runs/); }
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockImplementation(async (_url, options) => ({ data: data(options?.params as Record<string, unknown>) })); });
afterEach(cleanup);
it('never reads until explicit submit, then shows complete counts and scope caveats', async () => {
  await open(); expect(get).not.toHaveBeenCalled(); await read(); expect(get).toHaveBeenLastCalledWith('/cases/agents/recorded-health', { params: { agent_type: '' } }); expect(screen.getByText('failed: 30')).toBeInTheDocument(); expect(screen.getByText(/not a liveness check/)).toBeInTheDocument();
});
it('applies exact UTC date window and agent only on submit', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Health from UTC date'), { target: { value: '2026-11-01' } }); fireEvent.change(screen.getByLabelText('Health before UTC date'), { target: { value: '2026-11-03' } }); expect(get).not.toHaveBeenCalled(); await read(); expect(get).toHaveBeenLastCalledWith('/cases/agents/recorded-health', { params: { agent_type: '', from_date: '2026-11-01', before_date: '2026-11-03' } });
});
it('prevents reversed or same-day windows', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Health from UTC date'), { target: { value: '2026-11-03' } }); fireEvent.change(screen.getByLabelText('Health before UTC date'), { target: { value: '2026-11-03' } }); expect(screen.getByRole('button', { name: 'Read recorded execution health' })).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('excluded');
});
it('keeps dirty drafts distinct and disables download until applied or cleared', async () => {
  await open(); await read(); fireEvent.change(screen.getByLabelText('Health exact agent type'), { target: { value: 'triage' } }); expect(screen.getByText(/Draft dates or agent type are not applied/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Download loaded recorded health JSON' })).toBeDisabled(); expect(get).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Clear recorded health' })); expect(screen.queryByText(/70 owned recorded runs/)).not.toBeInTheDocument();
});
it('filters and exports all loaded groups without new reads', async () => {
  await open(); await read(); fireEvent.change(screen.getByLabelText('Health group status'), { target: { value: JSON.stringify('failed') } }); expect(screen.getByText('hunt · failed')).toBeInTheDocument(); expect(screen.queryByText('triage · completed')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Download loaded recorded health JSON' })); const payload = JSON.parse(save.mock.calls[0][0]); expect(payload.groups).toHaveLength(3); expect(payload.total).toBe(70); expect(payload.oldest_running[0].id).toBe(77); expect(get).toHaveBeenCalledTimes(1);
});
it('opens exact owned running record without retry or mutation', async () => {
  await open(); await read(); get.mockResolvedValueOnce({ data: { id: 77, agent_type: 'hunt', status: 'running', started_at: '2026-11-01T00:00:00Z', completed_at: null, model_used: null, prompt_tokens: 0, completion_tokens: 0, result_summary: 'Saved running record', error_message: null, steps: [] } }); fireEvent.click(screen.getByRole('button', { name: /Inspect running record #77/ })); expect(await screen.findByText('Saved running record')).toBeInTheDocument(); expect(get).toHaveBeenLastCalledWith('/cases/agents/runs/77');
});
it.each(['from_date', 'total', 'groups', 'oldest_running', 'retrieved_at'])('rejects malformed scope/count evidence %s', async key => {
  get.mockResolvedValueOnce({ data: { ...data(), [key]: key === 'groups' ? [group('hunt', 'failed')] : 'wrong' } }); await open(); fireEvent.click(screen.getByRole('button', { name: 'Read recorded execution health' })); expect(await screen.findByRole('alert')).toHaveTextContent('did not match'); expect(screen.queryByText(/70 owned recorded runs/)).not.toBeInTheDocument();
});
it('ignores a late response after close and reads fresh only on resubmit', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await open(); fireEvent.click(screen.getByRole('button', { name: 'Read recorded execution health' })); fireEvent.click(screen.getByRole('button', { name: 'Review recorded agent execution health' })); await act(async () => resolve({ data: data() })); fireEvent.click(screen.getByRole('button', { name: 'Review recorded agent execution health' })); expect(get).toHaveBeenCalledTimes(1); await read(); expect(get).toHaveBeenCalledTimes(2);
});
it('keeps unavailable different from empty and supports a fresh retry', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); await open(); fireEvent.click(screen.getByRole('button', { name: 'Read recorded execution health' })); expect(await screen.findByRole('alert')).toHaveTextContent('No absence of failures'); await read();
});

it('pages all groups locally and preserves empty or reserved statuses exactly', async () => {
  const groups = Array.from({ length: 24 }, (_, index) => group('agent-' + index, index === 0 ? '' : index === 1 ? 'all' : 'failed', 1));
  get.mockResolvedValueOnce({ data: { ...data(), total: 24, groups } }); await open(); fireEvent.click(screen.getByRole('button', { name: 'Read recorded execution health' })); await screen.findByText(/24 owned recorded runs/);
  expect(screen.getByRole('list', { name: 'Recorded health groups' }).children).toHaveLength(20); fireEvent.click(screen.getByRole('button', { name: 'More health groups' })); expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Health group status'), { target: { value: JSON.stringify('') } }); expect(screen.getByText('agent-0 · (empty status)')).toBeInTheDocument(); expect(screen.getByText(/1 matching groups/)).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});

it('drills into the applied group scope, refuses dirty drafts, and removes the drilldown on health refresh', async () => {
  await open(); await read(); const browse = screen.getByRole('button', { name: 'Browse exact run group: hunt / failed' });
  fireEvent.change(screen.getByLabelText('Health exact agent type'), { target: { value: 'new draft' } }); expect(browse).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Health exact agent type'), { target: { value: '' } });
  get.mockResolvedValueOnce({ data: { agent_type: 'hunt', run_status: 'failed', from_date: null, before_date: null, page: 1, size: 10, total: 0, records: [], retrieved_at: '2026-11-22T01:00:00Z', scope: 'Exact current group' } });
  fireEvent.click(browse); await screen.findByText(/0 current group records/); expect(get).toHaveBeenLastCalledWith('/cases/agents/recorded-health/runs', { params: { agent_type: 'hunt', run_status: 'failed', page: 1, size: 10 } });
  await read(); expect(screen.queryByRole('region', { name: 'Exact recorded health group runs' })).not.toBeInTheDocument();
});
