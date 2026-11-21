import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ValidationRoute } from './Validation';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const run = { id: 81, name: 'Older exact validation', description: 'Recorded review', status: 'completed', mode: 'dry_run', mitre_techniques: ['T1110'], results_summary: null, created_at: '2026-11-20T12:00:00Z', steps: [{ id: 1, technique_id: 'T1110', test_name: 'Recorded password check', actual_result: 'missed', simulated: true }] };
function Probe() { const location = useLocation(), navigate = useNavigate(); return <><span data-testid="location">{location.pathname}{location.search}</span><button onClick={() => navigate('/validation?run=82')}>Other exact run</button></>; }
const mount = (query: string) => render(<MemoryRouter initialEntries={[`/validation?${query}`]}><ValidationRoute /><Probe /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => ({ data: /^\/validation\/runs\/\d+$/.test(url) ? { data: { ...run, ...(url.endsWith('/82') ? { id: 82, name: 'Another exact validation' } : {}) } } : { data: [], total: 0 } })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('Exact validation record navigation', () => {
  it('opens a run outside history pages without executing and preserves other URL state on close', async () => {
    mount('run=81&keep=yes');
    expect(await screen.findByText('Older exact validation - Results')).toBeTruthy();
    expect(screen.getByText('Recorded password check')).toBeTruthy(); expect(get).toHaveBeenCalledWith('/validation/runs/81');
    expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close results' }));
    expect(screen.queryByText('Older exact validation - Results')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/validation?keep=yes');
  });
  it.each(['run=0', 'run=-1', 'run=1.5', 'run=81&run=82', 'run=', 'run=9007199254740992'])('rejects invalid exact run query %s without a detail read', async query => {
    mount(query); expect(await screen.findByRole('alert')).toBeTruthy();
    expect(get.mock.calls.some(([url]) => /^\/validation\/runs\/\d+$/.test(url))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear invalid run link' }));
    expect(screen.getByTestId('location').textContent).toBe('/validation');
  });
  it('follows same-page links and discards obsolete detail evidence', async () => {
    let finish!: (value: unknown) => void;
    const original = get.getMockImplementation()!;
    get.mockImplementation((url, config) => url === '/validation/runs/81' ? new Promise(resolve => { finish = resolve; }) : original(url, config));
    mount('run=81'); fireEvent.click(screen.getByText('Other exact run'));
    await screen.findByText('Another exact validation - Results');
    await act(async () => finish({ data: { data: run } }));
    expect(screen.queryByText('Older exact validation - Results')).toBeNull();
  });
  it('copies only the exact current locator and states access/current-read limits', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.history.replaceState({}, '', '/app/validation?private=draft#results');
    mount('run=81'); await screen.findByText('Older exact validation - Results');
    fireEvent.click(screen.getByRole('button', { name: 'Copy exact validation run link' }));
    await screen.findByText('Validation run link copied.');
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/validation?run=81`);
    expect(screen.getByText(/does not execute tests or grant access/)).toBeTruthy();
  });
  it('shows a missing/denied record and retries without substituting list evidence', async () => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async (url, config) => { if (url === '/validation/runs/81') throw new Error('Run not visible'); return original(url, config); });
    mount('run=81'); expect(await screen.findByText('Run not visible')).toBeTruthy();
    expect(screen.queryByText('Older exact validation - Results')).toBeNull();
    get.mockImplementation(original); fireEvent.click(screen.getByRole('button', { name: 'Retry run details' }));
    expect(await screen.findByText('Older exact validation - Results')).toBeTruthy();
  });
  it('does not accept the wrong record or claim a failed copy succeeded', async () => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async (url, config) => url === '/validation/runs/81' ? { data: { data: { ...run, id: 999 } } } : original(url, config));
    mount('run=81'); expect(await screen.findByText('The response did not match this validation run. Try again.')).toBeTruthy();
    get.mockImplementation(original); fireEvent.click(screen.getByRole('button', { name: 'Retry run details' }));
    await screen.findByText('Older exact validation - Results');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy exact validation run link' }));
    expect(await screen.findByText('The validation run link could not be copied. Try again.')).toBeTruthy();
    expect(screen.queryByText('Validation run link copied.')).toBeNull();
    await waitFor(() => expect(apiClient.post).not.toHaveBeenCalled());
  });
});
