import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AgentHealthRuns } from './AgentHealthRuns';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get), close = vi.fn();
const scope = { agent_type: 'hunt', run_status: 'failed', from_date: '2026-11-01', before_date: '2026-11-03', report_count: 11, report_read_at: '2026-11-22T00:00:00Z' };
const data = (page = 1, total = 11) => ({ ...scope, page, size: 10, total, retrieved_at: '2026-11-22T01:00:00Z', scope: 'Current exact recorded group', records: Array.from({ length: Math.min(10, Math.max(0, total - (page - 1) * 10)) }, (_, i) => ({ id: 100 - (page - 1) * 10 - i, agent_type: 'hunt', status: 'failed', started_at: '2026-11-01T00:00:00Z', completed_at: null, model_used: null })) });
beforeEach(() => { get.mockReset(); close.mockReset(); get.mockImplementation(async (_url, options) => ({ data: data(Number((options?.params as { page?: number })?.page ?? 1)) })); });
afterEach(cleanup);
it('requests the complete exact group window and stable server pages', async () => {
  render(<AgentHealthRuns scope={scope} onClose={close} />); await screen.findByText(/11 current group records · Page 1 of 2/); expect(get).toHaveBeenLastCalledWith('/cases/agents/recorded-health/runs', { params: { agent_type: 'hunt', run_status: 'failed', from_date: '2026-11-01', before_date: '2026-11-03', page: 1, size: 10 } }); fireEvent.click(screen.getByRole('button', { name: 'More health run records' })); await screen.findByText(/Page 2 of 2/); expect(screen.getByText('Recorded run #90')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'More health run records' })).toBeDisabled();
});
it('shows fresh-count divergence from the earlier aggregate without rewriting that report', async () => {
  get.mockResolvedValueOnce({ data: data(1, 2) }); render(<AgentHealthRuns scope={scope} onClose={close} />); expect(await screen.findByText(/differs from the earlier health report/)).toBeInTheDocument(); expect(screen.getByText(/health report had 11 records/)).toBeInTheDocument();
});
it('preserves empty exact identities and unbounded dates', async () => {
  get.mockResolvedValueOnce({ data: { ...data(1, 0), agent_type: '', run_status: '', from_date: null, before_date: null } }); render(<AgentHealthRuns scope={{ ...scope, agent_type: '', run_status: '', from_date: null, before_date: null }} onClose={close} />); await screen.findByText(/0 current group records/); expect(get).toHaveBeenLastCalledWith('/cases/agents/recorded-health/runs', { params: { agent_type: '', run_status: '', page: 1, size: 10 } }); expect(screen.getByText(/does not prove no activity occurred/)).toBeInTheDocument();
});
it.each(['agent_type', 'run_status', 'from_date', 'page', 'total', 'records'])('rejects malformed or broadened scope %s', async key => {
  get.mockResolvedValueOnce({ data: { ...data(), [key]: key === 'records' ? [] : 'wrong' } }); render(<AgentHealthRuns scope={scope} onClose={close} />); expect(await screen.findByRole('alert')).toHaveTextContent(/did not match|incomplete page/); expect(screen.queryByText('Recorded run #100')).not.toBeInTheDocument();
});
it('opens an exact group run with no execution and keeps the group after inspector close', async () => {
  render(<AgentHealthRuns scope={scope} onClose={close} />); await screen.findByText('Recorded run #100'); get.mockResolvedValueOnce({ data: { id: 100, agent_type: 'hunt', status: 'failed', started_at: '2026-11-01T00:00:00Z', completed_at: null, prompt_tokens: 0, completion_tokens: 0, model_used: null, result_summary: 'Exact saved run evidence', error_message: null, steps: [] } }); fireEvent.click(screen.getByRole('button', { name: 'Inspect group run #100' })); expect(await screen.findByText('Exact saved run evidence')).toBeInTheDocument(); expect(get).toHaveBeenLastCalledWith('/cases/agents/runs/100'); fireEvent.click(screen.getByRole('button', { name: 'Close run' })); expect(screen.getByText('Recorded run #100')).toBeInTheDocument();
});
it('retries unavailable reads and reports close to parent', async () => {
  get.mockRejectedValueOnce(Error('Unavailable')); render(<AgentHealthRuns scope={scope} onClose={close} />); expect(await screen.findByRole('alert')).toHaveTextContent('No absence'); fireEvent.click(screen.getByRole('button', { name: 'Refresh exact health run group' })); await screen.findByText('Recorded run #100'); fireEvent.click(screen.getByRole('button', { name: 'Close health run group' })); expect(close).toHaveBeenCalledOnce();
});
it('ignores a late result after unmount', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); const { unmount } = render(<AgentHealthRuns scope={scope} onClose={close} />); unmount(); await act(async () => resolve({ data: data() })); expect(screen.queryByText('Recorded run #100')).not.toBeInTheDocument();
});
it('clamps a page when the fresh group total shrinks', async () => {
  render(<AgentHealthRuns scope={scope} onClose={close} />); await screen.findByText('Recorded run #100'); get.mockResolvedValueOnce({ data: { ...data(2, 2), records: [] } }); get.mockResolvedValueOnce({ data: data(1, 2) }); fireEvent.click(screen.getByRole('button', { name: 'More health run records' })); expect(await screen.findByText(/2 current group records · Page 1 of 1/)).toBeInTheDocument();
});
