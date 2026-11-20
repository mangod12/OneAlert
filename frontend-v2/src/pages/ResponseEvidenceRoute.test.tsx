import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import apiClient from '../api/client';
import { ResponsePlansRoute } from './ResponsePlans';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => {
  const match = String(url).match(/response-plans\/(\d+)\/decision-evidence$/);
  return { data: match ? { schema_version: 1, scope: 'mutable records', retrieved_at: '2026-11-20T18:00:00Z', plan: { id: Number(match[1]), case_id: 10, status: 'partial', autonomy_level: 'L1', actions: [] }, approval_page: 1, approval_size: 10, approval_total: 0, approval_records: [] } : { data: [], total: 0 } };
}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const show = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><Link to="/response-plans?plan=8">Next exact plan</Link><Link to="/response-plans">Clear linked plan</Link><Routes><Route path="/response-plans" element={<ResponsePlansRoute />} /></Routes></MemoryRouter>);
it('opens exact URL evidence outside the list and responds to same-route query navigation', async () => {
  show('/response-plans?plan=7&status=completed');
  await screen.findByText('Plan #7 · Case #10');
  expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Next exact plan' }));
  await screen.findByText('Plan #8 · Case #10'); expect(screen.queryByText('Plan #7 · Case #10')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Clear linked plan' })); expect(screen.queryByText('Plan #8 · Case #10')).toBeNull();
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
it('does not choose between duplicate URL plan IDs', async () => {
  show('/response-plans?plan=7&plan=8');
  await screen.findByText(/invalid plan ID/);
  expect(get.mock.calls.some(([url]) => String(url).endsWith('/decision-evidence'))).toBe(false);
});
