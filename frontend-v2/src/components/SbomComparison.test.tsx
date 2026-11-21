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
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [component(), component({ id: 2, version: '2.0' })] : [component({ sbom_id: 3 })] }));
  renderComparison(); choose();
  expect(await screen.findByText('ambiguous: 1')).toBeTruthy();
  expect(screen.getByText(/Baseline has 2 rows; current has 1 rows/)).toBeTruthy();
  expect(screen.queryByText('Baseline: 3.0')).toBeNull();
});

it('filters and pages comparison groups locally without fetching again', async () => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [] : Array.from({ length: 20 }, (_, i) => component({ id: i + 1, sbom_id: 3, name: `package-${String(i).padStart(2, '0')}` })) }));
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
    return Promise.resolve({ data: url === '/sbom/1/components' ? [component({ sbom_id: 1, name: 'New baseline' })] : [] });
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
  get.mockImplementation(async url => ({ data: [component({ sbom_id: url === '/sbom/2/components' ? 2 : 3 })] }));
  renderComparison(); choose();
  await screen.findByText('unchanged: 1');
  expect(screen.queryByRole('heading', { name: 'openssl' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Comparison change type'), { target: { value: 'unchanged' } });
  const card = await screen.findByRole('article');
  expect(within(card).getByRole('heading', { name: 'openssl' })).toBeTruthy();
  expect(within(card).getByText('Baseline: 2')).toBeTruthy();
});

it('exports every matching group across pages from loaded evidence, with no extra request', async () => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [] : Array.from({ length: 20 }, (_, i) => component({ id: i + 1, sbom_id: 3, name: `package-${String(i).padStart(2, '0')}` })) }));
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:comparison');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  renderComparison(); choose();
  await screen.findByText('added: 20');
  expect(screen.queryByRole('heading', { name: 'package-19' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Export matching comparison CSV' }));
  const blob = createUrl.mock.calls[0][0] as Blob;
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
  expect(text).toContain('package-00'); expect(text).toContain('package-19');
  expect(get).toHaveBeenCalledTimes(2);
  expect(click).toHaveBeenCalledTimes(1);
  expect(revokeUrl).toHaveBeenCalledWith('blob:comparison');
  fireEvent.change(screen.getByLabelText('Comparison change type'), { target: { value: 'removed' } });
  expect((screen.getByRole('button', { name: 'Export matching comparison CSV' }) as HTMLButtonElement).disabled).toBe(true);
  createUrl.mockRestore(); revokeUrl.mockRestore(); click.mockRestore();
});

it('shows and searches recorded SHA-256 differences with a verification caveat', async () => {
  const beforeHash = 'a'.repeat(64);
  const afterHash = 'b'.repeat(64);
  get.mockImplementation(async url => ({ data: [component({ sbom_id: url === '/sbom/2/components' ? 2 : 3, hash_sha256: url === '/sbom/2/components' ? beforeHash : afterHash })] }));
  renderComparison(); choose();
  expect(await screen.findByText('changed: 1')).toBeTruthy();
  expect(screen.getByText('Recorded SHA-256')).toBeTruthy();
  expect(screen.getByText(`Baseline: ${beforeHash}`)).toBeTruthy();
  expect(screen.getByText(`Current: ${afterHash}`)).toBeTruthy();
  expect(screen.getByText(/not proof of tampering/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search snapshot comparison'), { target: { value: afterHash } });
  expect(screen.getByRole('heading', { name: 'openssl' })).toBeTruthy();
});


it('links every ambiguous source row to its own document and component without pairing duplicates', async () => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [component({ id: 21 }), component({ id: 22, version: '2.0' })] : [component({ id: 31, sbom_id: 3, version: '3.1' })] }));
  renderComparison(); choose(); await screen.findByText('ambiguous: 1');
  expect(screen.getByRole('link', { name: 'Open baseline component #21', hidden: true }).getAttribute('href')).toBe('/app/sbom?sbom=2&component=21');
  expect(screen.getByRole('link', { name: 'Open baseline component #22', hidden: true }).getAttribute('href')).toBe('/app/sbom?sbom=2&component=22');
  expect(screen.getByRole('link', { name: 'Open current component #31', hidden: true }).getAttribute('href')).toBe('/app/sbom?sbom=3&component=31');
  expect(screen.getByText(/No pairing is inferred/)).toBeTruthy(); expect(screen.queryByText('Baseline: 3.0')).toBeNull();
});
it.each([[component({ sbom_id: 1 })], [component({ id: 0 })], [component(), component()], [component({ id: 2147483648 })]].map(bad => ({ bad })))('rejects wrong-document or ambiguous row identity before comparison and export %#', async ({ bad }) => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? bad : [] })); renderComparison(); choose(); await screen.findByRole('alert');
  expect(screen.queryByText('added: 0')).toBeNull(); expect(screen.queryByRole('button', { name: 'Export matching comparison CSV' })).toBeNull(); expect(screen.queryByRole('link', { hidden: true })).toBeNull();
});
it('retains document-side absence instead of inventing a source record for an added group', async () => {
  get.mockImplementation(async url => ({ data: url === '/sbom/2/components' ? [] : [component({ id: 31, sbom_id: 3 })] })); renderComparison(); choose(); await screen.findByText('added: 1');
  expect(screen.getByText('No component in this name/supplier group.')).toBeTruthy(); expect(screen.queryByRole('link', { name: /Open baseline/, hidden: true })).toBeNull();
  expect(screen.getByRole('link', { name: 'Open current component #31', hidden: true })).toBeTruthy();
});
