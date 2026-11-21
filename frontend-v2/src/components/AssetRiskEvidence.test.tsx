import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { AssetRiskEvidence } from './AssetRiskEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const fixture = (page = 1) => ({ asset_id: 7, asset_name: 'Plant gateway', criticality: 'high', multiplier: 1.5, base_points: 65, rounded_points: 98, score: 98, level: 'critical', total: 12, page, size: 10, included_statuses: ['pending', 'sent', 'acknowledged'], status_counts: { pending: 4, sent: 4, acknowledged: 4, resolved: 1, failed: 1 }, severity_breakdown: [{ severity: 'critical', count: 1, weight: 10, base_points: 10 }, { severity: 'high', count: 11, weight: 5, base_points: 55 }], retrieved_at: '2026-11-21T04:00:00Z', records: Array.from({ length: page === 1 ? 10 : 2 }, (_, index) => ({ id: page === 1 ? 12 - index : 2 - index, title: `Finding ${page}-${index}`, severity: 'high', status: 'sent', base_points: 5, cve_id: null, created_at: '2026-11-21T03:00:00Z' })) });
const view = (id = 7) => <MemoryRouter><AssetRiskEvidence assetId={id} /></MemoryRouter>;
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (_url, config) => ({ data: fixture((config?.params as { page?: number } | undefined)?.page ?? 1) })); });
afterEach(cleanup);
const open = async () => { fireEvent.click(screen.getByRole('button', { name: 'Explain current asset risk' })); await screen.findByText('Current evidence score: critical (98)'); };
describe('Asset risk calculation evidence', () => {
  it('loads only on demand, explains the full score and links exact current contributors', async () => {
    render(view()); expect(get).not.toHaveBeenCalled(); await open();
    expect(get).toHaveBeenCalledWith('/assets/7/risk-evidence', { params: { page: 1, size: 10 } });
    expect(screen.getByText(/65 base points × 1.5/)).toBeTruthy();
    expect(screen.getByText(/12 contributing alerts; 2 owned alert records excluded/)).toBeTruthy();
    expect(screen.getByText('11 alerts × 5 = 55 base points')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open contributing alert #12: Finding 1-0' }).getAttribute('href')).toBe('/alerts?alert=12');
    expect(screen.getByText(/not a vulnerability scan or probability/)).toBeTruthy();
  });
  it('pages through all contributors without changing the full summary', async () => {
    render(view()); await open(); fireEvent.click(screen.getByRole('button', { name: 'More risk contributors' }));
    await screen.findByText(/Contributor page 2 of 2/);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('Current evidence score: critical (98)')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'More risk contributors' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous risk contributors' }));
    await screen.findByText(/Contributor page 1 of 2/);
  });
  it.each(['asset', 'arithmetic', 'status', 'duplicate', 'total'])('rejects mismatched %s evidence instead of displaying a score', async kind => {
    const data = fixture();
    if (kind === 'asset') data.asset_id = 8;
    if (kind === 'arithmetic') data.score = 99;
    if (kind === 'status') data.records[0].status = 'resolved';
    if (kind === 'duplicate') data.records[1].id = data.records[0].id;
    if (kind === 'total') data.total = 15;
    get.mockResolvedValue({ data }); render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Explain current asset risk' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Current evidence score:/)).toBeNull();
  });
  it('keeps the existing nearest-even half-point rounding and cap semantics', async () => {
    get.mockResolvedValue({ data: { ...fixture(), criticality: 'low', multiplier: 0.5, total: 1, base_points: 1, rounded_points: 0, score: 0, level: 'none', status_counts: { pending: 1 }, severity_breakdown: [{ severity: 'info', count: 1, weight: 1, base_points: 1 }], records: [{ ...fixture().records[0], severity: 'info', status: 'pending', base_points: 1 }] } });
    render(view()); fireEvent.click(screen.getByRole('button', { name: 'Explain current asset risk' }));
    expect(await screen.findByText('Current evidence score: none (0)')).toBeTruthy();
    get.mockResolvedValue({ data: { ...fixture(), criticality: 'critical', multiplier: 2, rounded_points: 130, score: 100 } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh risk evidence' }));
    expect(await screen.findByText('Current evidence score: critical (100)')).toBeTruthy();
  });
  it('handles a zero-contributor read without claiming the asset is safe', async () => {
    get.mockResolvedValue({ data: { ...fixture(), total: 0, base_points: 0, rounded_points: 0, score: 0, level: 'none', status_counts: { resolved: 8 }, severity_breakdown: [], records: [] } });
    render(view()); fireEvent.click(screen.getByRole('button', { name: 'Explain current asset risk' }));
    expect(await screen.findByText('No current contributing alerts. A zero score does not prove this asset is safe.')).toBeTruthy();
    expect(screen.getByText(/8 owned alert records excluded/)).toBeTruthy();
  });
  it('retries a failed read and ignores the obsolete response after changing assets', async () => {
    get.mockRejectedValueOnce(new Error('Risk unavailable')); render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Explain current asset risk' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Risk unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh risk evidence' }));
    await screen.findByText('Current evidence score: critical (98)');
    cleanup();
    let finish!: (value: unknown) => void;
    get.mockImplementation(url => url === '/assets/7/risk-evidence' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: { ...fixture(), asset_id: 8 } }));
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Explain current asset risk' }));
    rerender(view(8));
    await screen.findByText('Current evidence score: critical (98)');
    await act(async () => finish({ data: { ...fixture(), score: 99 } }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('clamps a page when contributing records shrink after a refresh', async () => {
    render(view()); await open(); fireEvent.click(screen.getByRole('button', { name: 'More risk contributors' }));
    await screen.findByText(/Contributor page 2 of 2/);
    get.mockImplementation(async (_url, config) => ({ data: { ...fixture((config?.params as { page?: number } | undefined)?.page ?? 1), total: 0, base_points: 0, rounded_points: 0, score: 0, level: 'none', status_counts: {}, severity_breakdown: [], records: [] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh risk evidence' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/assets/7/risk-evidence', { params: { page: 1, size: 10 } }));
    expect(await screen.findByText(/Contributor page 1 of 1/)).toBeTruthy();
  });
});
