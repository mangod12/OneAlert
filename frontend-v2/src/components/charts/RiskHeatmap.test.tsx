import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { RiskHeatmap } from './RiskHeatmap';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('RiskHeatmap', () => {
  it('shows a loading status while zone data is in flight', () => {
    get.mockReturnValue(new Promise(() => {}));
    render(<RiskHeatmap />);
    expect(screen.getByRole('status').textContent).toContain('Loading zone data');
  });

  it('shows an error instead of the empty-state hint when the request fails', async () => {
    get.mockRejectedValue(new Error('Service unavailable'));
    render(<RiskHeatmap />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/No OT zone data/)).toBeNull();
  });

  it('maps zone counts onto Purdue levels', async () => {
    get.mockResolvedValue({ data: { zones: [
      { zone: 'scada', count: 3 },
      { zone: 'process', count: 7 },
    ] } });
    render(<RiskHeatmap />);
    expect(await screen.findByText('Operations')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    const operations = items.find(item => item.textContent?.includes('Operations'));
    expect(operations?.textContent).toContain('3 devices');
    const process = items.find(item => item.textContent?.includes('Process'));
    expect(process?.textContent).toContain('7 devices');
  });

  it('shows the empty-state hint only after a successful empty response', async () => {
    get.mockResolvedValue({ data: { zones: [] } });
    render(<RiskHeatmap />);
    expect(await screen.findByText(/No OT zone data/)).toBeTruthy();
    expect(screen.getAllByRole('listitem').some(item => item.textContent?.includes('0 devices'))).toBe(true);
  });
});
