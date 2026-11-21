import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AuditLogRoute } from './AuditLog';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get), writeText = vi.fn();
const run = (id: number) => ({ id, agent_type: 'triage', status: 'failed', started_at: '2026-11-20T00:00:00Z', completed_at: null, model_used: null, prompt_tokens: 1, completion_tokens: 2, result_summary: `Exact historical run ${id}`, error_message: 'Recorded failure', steps: [] });
function Nav() { const navigate = useNavigate(), location = useLocation(); return <><button onClick={() => navigate('?run=82&private=keep')}>Open other run link</button><p data-testid="url">{location.search}</p></>; }
const show = (url = '/audit-log?run=81&private=keep#draft') => render(<MemoryRouter initialEntries={[url]}><AuditLogRoute /><Nav /></MemoryRouter>);
beforeEach(() => { get.mockReset(); writeText.mockReset(); writeText.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); get.mockImplementation(async url => ({ data: String(url).includes('/agents/runs/') ? run(Number(String(url).split('/').pop())) : String(url).endsWith('/agents/runs') ? [] : { logs: [], total: 0 } })); });
afterEach(cleanup);
it('opens an exact historical record outside the latest list and copies only its locator', async () => {
  show(); expect(await screen.findByText('Exact historical run 81')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy exact recorded run link' })); await screen.findByText('Recorded run link copied.');
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/audit-log?run=81`);
  expect(screen.getByText(/does not grant access, start an agent/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close run' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('url')).toHaveTextContent('?private=keep');
});
it.each(['run=0', 'run=-2', 'run=1.5', 'run=81&run=82', 'run=9007199254740992', 'run=word'])('blocks invalid exact links: %s', async query => {
  show(`/audit-log?${query}`); expect(screen.getByRole('alert')).toHaveTextContent('No run was opened');
  await waitFor(() => expect(get).toHaveBeenCalled()); expect(get.mock.calls.some(([url]) => String(url).includes('/agents/runs/'))).toBe(false);
});
it('does not fall back to another run after a denied or mismatched response', async () => {
  get.mockImplementation(async url => ({ data: String(url).includes('/agents/runs/') ? run(99) : String(url).endsWith('/agents/runs') ? [] : { logs: [], total: 0 } }));
  show(); expect(await screen.findByRole('alert')).toHaveTextContent('did not match'); expect(screen.queryByRole('button', { name: 'Copy exact recorded run link' })).not.toBeInTheDocument();
});
it('ignores stale exact-record reads after a same-page link change', async () => {
  let resolve!: (value: unknown) => void;
  get.mockImplementation(async url => String(url).endsWith('/runs/81') ? await new Promise(r => { resolve = r; }) : { data: String(url).includes('/agents/runs/') ? run(82) : String(url).endsWith('/agents/runs') ? [] : { logs: [], total: 0 } });
  show(); fireEvent.click(screen.getByRole('button', { name: 'Open other run link' })); await screen.findByText('Exact historical run 82');
  resolve({ data: run(81) }); await waitFor(() => expect(screen.queryByText('Exact historical run 81')).not.toBeInTheDocument());
});
it('reports copy failure without claiming success or changing the record', async () => {
  writeText.mockRejectedValueOnce(new Error('denied')); show(); await screen.findByText('Exact historical run 81');
  fireEvent.click(screen.getByRole('button', { name: 'Copy exact recorded run link' })); expect(await screen.findByRole('alert')).toHaveTextContent('could not be copied'); expect(screen.queryByText('Recorded run link copied.')).not.toBeInTheDocument();
});
