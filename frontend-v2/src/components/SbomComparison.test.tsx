import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SbomComparison } from './SbomComparison';
import type { SnapshotComponent } from '../utils/sbomComparison';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const snapshots = [
  { id: 3, asset_id: 7, created_at: '2026-11-20T08:00:00Z', format: 'CycloneDX' },
  { id: 2, asset_id: 7, created_at: '2026-11-19T08:00:00Z', format: 'SPDX' },
  { id: 1, asset_id: 7, created_at: '2026-11-18T08:00:00Z', format: 'CycloneDX' },
  { id: 4, asset_id: 8, created_at: '2026-11-17T08:00:00Z', format: 'CycloneDX' },
];
const component = (overrides: Partial<SnapshotComponent> = {}): SnapshotComponent => ({ id: 1, sbom_id: 2, name: 'openssl', supplier: 'OpenSSL', version: '3.0', purl: null, cpe: null, license: 'Apache-2.0', has_known_vulnerability: 2, ...overrides });
function renderComparison(list = snapshots) { return render(<SbomComparison current={snapshots[0]} snapshots={list} onClose={vi.fn()} />); }
function choose(id = '2') { fireEvent.change(screen.getByLabelText('Baseline SBOM snapshot'), { target: { value: id } }); }
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it('offers only other snapshots for this asset and waits for a baseline choice', () => {
  renderComparison();
  expect(get).not.toHaveBeenCalled();
  expect(screen.getAllByRole('option')).toHaveLength(3);
  expect(screen.queryByRole('option', { name: /SBOM #4/ })).toBeNull();
  expect(screen.queryByRole('option', { name: /SBOM #3/ })).toBeNull();
});

it('explains when there is no second snapshot', () => {
  renderComparison([snapshots[0], snapshots[3]]);
  expect(screen.getByText('Upload another SBOM for this asset to compare snapshots.')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});

it('shows before and after evidence, preserving zero as recorded evidence', async () => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [component()] : [component({ sbom_id: 3, version: '3.1', has_known_vulnerability: 0 })] }));
  renderComparison(); choose();
  expect(await screen.findByText('changed: 1')).toBeTruthy();
  expect(screen.getByText('Baseline: 3.0')).toBeTruthy();
  expect(screen.getByText('Current: 3.1')).toBeTruthy();
  expect(screen.getByText('Current: 0')).toBeTruthy();
  expect(screen.getByText(/not a live vulnerability scan/)).toBeTruthy();
  expect(get).toHaveBeenCalledWith('/sbom/2/components');
  expect(get).toHaveBeenCalledWith('/sbom/3/components');
});

it('flags duplicate identities without inventing a version pairing', async () => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [component(), component({ version: '2.0' })] : [component({ sbom_id: 3 })] }));
  renderComparison(); choose();
  expect(await screen.findByText('ambiguous: 1')).toBeTruthy();
  expect(screen.getByText(/Baseline has 2 rows; current has 1 rows/)).toBeTruthy();
  expect(screen.queryByText('Baseline: 3.0')).toBeNull();
});

it('filters and pages comparison groups locally without fetching again', async () => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [] : Array.from({ length: 20 }, (_, i) => component({ id: i, sbom_id: 3, name: `package-${String(i).padStart(2, '0')}` })) }));
  renderComparison(); choose();
  await screen.findByText('added: 20');
  expect(screen.queryByRole('heading', { name: 'package-19' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More comparison groups' }));
  expect(screen.getByRole('heading', { name: 'package-19' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search snapshot comparison'), { target: { value: 'package-01' } });
  expect(screen.getByRole('heading', { name: 'package-01' })).toBeTruthy();
  expect(screen.getByText('1 of 20 groups match. Page 1 of 1.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Comparison change type'), { target: { value: 'removed' } });
  expect(screen.getByText('No component groups match these filters.')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});

it('fails instead of claiming no differences when one inventory cannot load, then retries both', async () => {
  let fail = true;
  get.mockImplementation(async url => { if (url === '/sbom/2/components' && fail) throw new Error('No baseline available'); return { data: [] }; });
  renderComparison(); choose();
  await screen.findByRole('button', { name: 'Retry comparison' });
  expect(screen.queryByText('added: 0')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry comparison' }));
  expect(await screen.findByText('added: 0')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(4);
});

it('discards a stale baseline response after the selected baseline changes', async () => {
  let resolveOld!: (value: unknown) => void;
  get.mockImplementation(url => {
    if (url === '/sbom/2/components') return new Promise(resolve => { resolveOld = resolve; });
    return Promise.resolve({ data: url === '/sbom/1/components' ? [component({ name: 'New baseline' })] : [] });
  });
  renderComparison(); choose();
  await screen.findByText('Loading both component inventories...');
  choose('1');
  expect(await screen.findByRole('heading', { name: 'New baseline' })).toBeTruthy();
  await act(async () => resolveOld({ data: [component({ name: 'Stale baseline' })] }));
  expect(screen.queryByRole('heading', { name: 'Stale baseline' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'New baseline' })).toBeTruthy();
});

it('does not claim identical snapshots are remediated and can reveal unchanged evidence', async () => {
  get.mockResolvedValue({ data: [component()] });
  renderComparison(); choose();
  await screen.findByText('unchanged: 1');
  expect(screen.queryByRole('heading', { name: 'openssl' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Comparison change type'), { target: { value: 'unchanged' } });
  const card = await screen.findByRole('article');
  expect(within(card).getByRole('heading', { name: 'openssl' })).toBeTruthy();
  expect(within(card).getByText('Baseline: 2')).toBeTruthy();
});
