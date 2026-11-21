import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { MitreReferenceExplorer } from './MitreReferenceExplorer';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
type Scope = { kind: string; page: number; size: number; query: string; rule_state: string };
const fixture = (params: Scope) => ({ ...params, technique_id: 'T1190', technique_name: 'Exploit Public-Facing Application', total: 25, counts: { cases: 25, detection_rules: 25, enabled_rules: 13, disabled_rules: 12 }, retrieved_at: '2026-11-21T06:00:00Z', records: [{ id: params.page === 1 ? 25 : 15, ...(params.kind === 'cases' ? { title: 'Gateway 100%_safe', status: 'closed' } : { name: 'Rule 100%_safe', enabled: params.rule_state !== 'disabled' }) }] });
const view = () => render(<MemoryRouter><MitreReferenceExplorer /></MemoryRouter>);
const load = () => { fireEvent.change(screen.getByLabelText('Reference evidence technique ID'), { target: { value: ' t1190 ' } }); fireEvent.click(screen.getByRole('button', { name: 'Load full technique references' })); };
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (_url, config) => ({ data: fixture(config?.params as Scope) })); });
afterEach(cleanup);
describe('Full technique reference explorer', () => {
  it('loads on demand and shows full counts with exact case routes beyond preview pages', async () => {
    view(); expect(get).not.toHaveBeenCalled(); load();
    expect(await screen.findByText(/Full reference set: 25 cases/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open exact case #25: Gateway 100%_safe' }).getAttribute('href')).toBe('/cases/25');
    fireEvent.click(screen.getByRole('button', { name: 'More technique references' }));
    expect(await screen.findByRole('link', { name: 'Open exact case #15: Gateway 100%_safe' })).toBeTruthy();
    expect(get).toHaveBeenLastCalledWith('/mitre/techniques/T1190/reference-evidence', { params: { page: 2, size: 10, kind: 'cases', query: '', rule_state: 'all' } });
    expect(screen.getByText(/does not prove tested or live detection/)).toBeTruthy();
  });
  it('searches literal displayed fields across all rules and keeps drafts unapplied', async () => {
    view(); load(); await screen.findByText(/Full reference set:/);
    fireEvent.change(screen.getByLabelText('Technique reference kind'), { target: { value: 'detection_rules' } });
    fireEvent.change(await screen.findByLabelText('Technique reference rule state'), { target: { value: 'disabled' } });
    await screen.findByText('Recorded state: disabled');
    fireEvent.change(screen.getByLabelText('Search technique references'), { target: { value: '  100%_safe  ' } });
    expect(screen.getByText(/Reference search draft not applied/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search technique references' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/mitre/techniques/T1190/reference-evidence', { params: { page: 1, size: 10, kind: 'detection_rules', query: '100%_safe', rule_state: 'disabled' } }));
    expect(screen.getByRole('link', { name: /Open exact saved rule/  }).getAttribute('href')).toBe('/hunt?rule=25');
    fireEvent.click(screen.getByRole('button', { name: 'Clear reference filters' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/mitre/techniques/T1190/reference-evidence', { params: { page: 1, size: 10, kind: 'detection_rules', query: '', rule_state: 'all' } }));
  });
  it('rejects a mismatched response and retries without showing unrelated references', async () => {
    get.mockImplementationOnce(async (_url, config) => ({ data: { ...fixture(config?.params as Scope), technique_id: 'T1078' } }));
    view(); load(); expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Full reference set:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh full technique references' }));
    expect(await screen.findByText(/Full reference set:/)).toBeTruthy();
  });
  it('ignores stale page results and handles an empty filtered set', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    view(); load();
    get.mockImplementation(async (_url, config) => ({ data: { ...fixture(config?.params as Scope), total: 0, records: [] } }));
    fireEvent.change(screen.getByLabelText('Technique reference kind'), { target: { value: 'detection_rules' } });
    expect(await screen.findByText('No recorded references match this technique and filter scope.')).toBeTruthy();
    await act(async () => finish({ data: fixture({ kind: 'cases', page: 1, size: 10, query: '', rule_state: 'all' }) }));
    expect(screen.queryByRole('link', { name: /Open exact case/ })).toBeNull();
  });
});
