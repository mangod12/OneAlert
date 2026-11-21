import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { DetectionCoveragePreview } from './DetectionCoveragePreview';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const fixture = { hours_back: 24, cutoff: '2026-11-20T12:00:00Z', retrieved_at: '2026-11-21T12:00:00Z', total_events: 80, alert_events: 8, ai_eligible: true, severity_distribution: { high: 8, info: 72 }, top_sources: [{ label: '10.0.0.1', count: 75 }], top_ports: [{ label: '502', count: 12 }], top_signatures: [{ label: 'Saved signature', count: 12 }], rule_findings: [{ title: 'High-volume activity', severity: 'medium', description: 'A current rule candidate, not confirmed scanning.', recommended_actions: ['Review original telemetry'] }] };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Preview detection coverage' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); });
afterEach(cleanup);
it('reads only on demand, labels actual rule/AI scope and changes no state', async () => {
  render(<DetectionCoveragePreview />); expect(get).not.toHaveBeenCalled(); open(); await screen.findByText('80');
  expect(get).toHaveBeenCalledWith('/cases/detection-preview', { params: { hours_back: 24 } });
  expect(screen.getByText(/No AI was run/)).toBeTruthy(); expect(screen.getByText(/Includes processed and already-linked/)).toBeTruthy();
  expect(screen.getByText(/not a saved run result/)).toBeTruthy(); expect(screen.getByText(/AI, when eligible/)).toBeTruthy();
  expect(screen.getByText(/High-volume activity · medium/)).toBeTruthy(); expect(apiClient.post).not.toHaveBeenCalled();
});
it('uses a separate lookback and refreshes, close hides current data', async () => {
  render(<DetectionCoveragePreview />); open(); await screen.findByText('80');
  get.mockResolvedValueOnce({ data: { ...fixture, hours_back: 72, cutoff: '2026-11-18T12:00:00Z' } });
  fireEvent.change(screen.getByLabelText('Detection preview lookback'), { target: { value: '72' } }); await screen.findByText('80');
  expect(get).toHaveBeenLastCalledWith('/cases/detection-preview', { params: { hours_back: 72 } }); open(); expect(screen.queryByText('80')).toBeNull();
});
it.each([{ hours_back: 72 }, { ai_eligible: false }, { total_events: -1 }, { alert_events: 81 }, { cutoff: 'bad' }, { top_sources: [{ label: 'x', count: 81 }] }, { top_ports: [{ label: '502', count: -1 }] }, { top_sources: [{ label: 'x', count: 1 }, { label: 'x', count: 1 }] }, { severity_distribution: { high: 5 } }, { rule_findings: [{}] }])('rejects inconsistent scope and aggregate payload %j', async changes => {
  get.mockResolvedValueOnce({ data: { ...fixture, ...changes } }); render(<DetectionCoveragePreview />); open(); await screen.findByRole('alert'); expect(screen.queryByText('80')).toBeNull();
});
it('labels zero candidates and ineligible AI as unknown safety, not a clean bill', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, total_events: 0, alert_events: 0, ai_eligible: false, severity_distribution: {}, top_sources: [], top_ports: [], top_signatures: [], rule_findings: [] } });
  render(<DetectionCoveragePreview />); open(); await screen.findByText(/No current rule candidates/); expect(screen.getByText(/Not eligible under/)).toBeTruthy();
});
it('suppresses late reads after a lookback change and retries source errors', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<DetectionCoveragePreview />); open(); get.mockRejectedValueOnce(new Error('Unavailable')); fireEvent.change(screen.getByLabelText('Detection preview lookback'), { target: { value: '72' } }); await screen.findByRole('alert');
  await act(async () => finish({ data: fixture })); expect(screen.queryByText('80')).toBeNull();
  get.mockResolvedValueOnce({ data: { ...fixture, hours_back: 72, cutoff: '2026-11-18T12:00:00Z' } }); fireEvent.click(screen.getByRole('button', { name: 'Refresh detection coverage' })); await screen.findByText('80');
});
