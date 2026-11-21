import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SbomRecordInspector } from './SbomRecordInspector';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get), close = vi.fn();
const snapshot = { sbom: { id: 99, asset_id: 7, format: 'SPDX', version: '2.3', source: 'upload', created_at: '2026-11-20T00:00:00Z', component_count: 11 }, page: 1, size: 10, search: '', vulnerable_only: false, gap: '', total: 11, document_total: 11, retrieved_at: '2026-11-21T00:00:00Z', components: [{ id: 209, sbom_id: 99, name: 'Saved component', version: null, supplier: null, purl: null, cpe: null, license: 'MIT', hash_sha256: null, has_known_vulnerability: 0 }] };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: snapshot }); });
afterEach(cleanup);
it('reads an exact document without a list lookup and shows missing and zero evidence explicitly', async () => {
  render(<SbomRecordInspector sbomId={99} onClose={close} />); await screen.findByText('Component #209: Saved component');
  expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/99/component-evidence', { params: { page: 1, size: 10, search: '', vulnerable_only: false, gap: '' } });
  expect(screen.getByText('0')).toBeTruthy(); expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: 'Open exact asset #7' }).getAttribute('href')).toBe('/app/assets?asset=7');
});
it('pages and applies search and gap/vulnerability scope on the server', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as Record<string, unknown>) } }));
  render(<SbomRecordInspector sbomId={99} onClose={close} />); await screen.findByText('Component #209: Saved component');
  fireEvent.click(screen.getByRole('button', { name: 'More evidence components' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/sbom/99/component-evidence', { params: { page: 2, size: 10, search: '', vulnerable_only: false, gap: '' } }));
  fireEvent.change(screen.getByLabelText('Exact SBOM component search'), { target: { value: 'openssl' } }); fireEvent.click(screen.getByRole('button', { name: 'Search saved components' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/sbom/99/component-evidence', { params: { page: 1, size: 10, search: 'openssl', vulnerable_only: false, gap: '' } }));
  fireEvent.change(screen.getByLabelText('Exact SBOM evidence gap'), { target: { value: 'hash' } }); fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/sbom/99/component-evidence', { params: { page: 1, size: 10, search: 'openssl', vulnerable_only: true, gap: 'hash' } }));
});
it('clears old evidence on failed refresh and can retry', async () => {
  render(<SbomRecordInspector sbomId={99} onClose={close} />); await screen.findByText('Component #209: Saved component'); get.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh SBOM evidence' })); await screen.findByRole('alert'); expect(screen.queryByText('Component #209: Saved component')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh SBOM evidence' })); await screen.findByText('Component #209: Saved component');
});
it.each([{ ...snapshot, sbom: { ...snapshot.sbom, id: 98 } }, { ...snapshot, page: 2 }, { ...snapshot, gap: 'hash' }, { ...snapshot, vulnerable_only: true }, { ...snapshot, components: [{ ...snapshot.components[0], sbom_id: 98 }] }])('rejects a mismatched document or component scope %#', async data => {
  get.mockResolvedValue({ data }); render(<SbomRecordInspector sbomId={99} onClose={close} />); await screen.findByRole('alert'); expect(screen.queryByText('Component #209: Saved component')).toBeNull();
});
it('ignores a stale component page after the filter changes', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  render(<SbomRecordInspector sbomId={99} onClose={close} />); get.mockResolvedValue({ data: { ...snapshot, gap: 'hash', components: [] } });
  fireEvent.change(screen.getByLabelText('Exact SBOM evidence gap'), { target: { value: 'hash' } }); await screen.findByText('No saved components match these filters.');
  await act(async () => resolve({ data: snapshot })); expect(screen.queryByText('Component #209: Saved component')).toBeNull();
});
it('recovers from a disappeared page and closes with Escape', async () => {
  get.mockImplementation(async (_url, config) => ({ data: { ...snapshot, ...(config?.params as Record<string, unknown>), total: get.mock.calls.length === 1 ? 11 : 1 } }));
  render(<SbomRecordInspector sbomId={99} onClose={close} />); await screen.findByText('Component #209: Saved component'); fireEvent.click(screen.getByRole('button', { name: 'More evidence components' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3)); expect(screen.getByRole('button', { name: 'Previous evidence components' })).toHaveProperty('disabled', true);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1);
});
it('opens exactly one component with its document provenance and no broad search controls', async () => {
  get.mockResolvedValueOnce({ data: { ...snapshot, component_id: 209, total: 1 } }); const browse = vi.fn(); render(<SbomRecordInspector sbomId={99} componentId={209} onBrowseDocument={browse} onClose={close} />); await screen.findByText('Component #209: Saved component');
  expect(get).toHaveBeenCalledExactlyOnceWith('/sbom/99/component-evidence', { params: { page: 1, size: 10, search: '', vulnerable_only: false, gap: '', component_id: 209 } }); expect(screen.queryByLabelText('Exact SBOM component search')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Browse all components in this SBOM' })); expect(browse).toHaveBeenCalledOnce();
});
it.each([{ ...snapshot, component_id: 208, total: 1 }, { ...snapshot, component_id: 209, total: 0, components: [] }, { ...snapshot, component_id: 209, total: 1, components: [{ ...snapshot.components[0], id: 208 }] }])('does not substitute other component evidence for an exact record %#', async data => {
  get.mockResolvedValueOnce({ data }); render(<SbomRecordInspector sbomId={99} componentId={209} onClose={close} />); await screen.findByRole('alert'); expect(screen.queryByText('Component #209: Saved component')).toBeNull();
});
