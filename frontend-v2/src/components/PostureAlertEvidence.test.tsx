import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { PostureAlertEvidence } from './PostureAlertEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { id: 81, title: 'Historical gateway alert', status: 'resolved', severity: 'high', created_at: '2026-09-01T00:00:00Z', metric_at: '2026-11-20T00:00:00Z', duration_seconds: null, timing_reason: 'Not a response-time metric.' };
const data = (params: Record<string, unknown>) => ({ ...params, total: 1, source_count: 1, window_start: '2026-10-22T00:00:00Z', generated_at: '2026-11-21T00:00:00Z', timing_count: params.metric === 'opened' ? null : 1, excluded_timing_count: params.metric === 'opened' ? null : 0, mean_seconds: params.metric === 'opened' ? null : 3600, records: [{ ...row, duration_seconds: params.metric === 'opened' ? null : 3600 }] });
const show = () => render(<MemoryRouter><PostureAlertEvidence days={30} /></MemoryRouter>);
afterEach(cleanup);
beforeEach(() => { get.mockReset(); get.mockImplementation(async (_url, options) => ({ data: data(options?.params as Record<string, unknown>) })); });
it('opens read-only source records and exact alert destination', async () => {
  show(); expect(await screen.findByText('#81: Historical gateway alert')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open alert #81' })).toHaveAttribute('href', '/alerts?alert=81');
  expect(screen.getByText(/not a frozen report or audit history/)).toBeInTheDocument();
  expect(screen.queryByText(/Current full-metric mean/)).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/reports/posture/alert-records', { params: { metric: 'opened', days: 30, query: '', offset: 0, limit: 20 } });
});
it('reviews response timing and exclusions independently from search', async () => {
  show(); await screen.findByText('#81: Historical gateway alert');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acknowledged' } });
  expect(await screen.findByText(/Current full-metric mean/)).toHaveTextContent('1 usable timings; 0 missing or negative timings excluded');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '100%_safe' } });
  await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.anything(), { params: expect.objectContaining({ metric: 'acknowledged', query: '100%_safe', offset: 0 }) }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear metric search' }));
  expect(screen.getByRole('searchbox')).toHaveValue('');
});
it('keeps unknown timing distinct from zero', async () => {
  get.mockImplementation(async (_url, options) => ({ data: { ...data(options?.params as Record<string, unknown>), timing_count: 0, excluded_timing_count: 1, mean_seconds: null } }));
  show(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'resolved' } });
  expect(await screen.findByText(/Current full-metric mean/)).toHaveTextContent('0 usable timings; 1 missing or negative timings excluded');
});
it('pages the whole metric then resets on search', async () => {
  get.mockImplementation(async (_url, options) => ({ data: { ...data(options?.params as Record<string, unknown>), total: 21, source_count: 21 } }));
  show(); await screen.findByText('#81: Historical gateway alert');
  fireEvent.click(screen.getByRole('button', { name: 'Next metric page' }));
  await screen.findByText('Page 2');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gateway' } });
  await screen.findByText('Page 1');
  expect(get).toHaveBeenLastCalledWith(expect.anything(), { params: expect.objectContaining({ offset: 0, query: 'gateway' }) });
});
it('fails closed and retries without inferring empty data', async () => {
  get.mockRejectedValueOnce(new Error('Permission unavailable'));
  show(); expect(await screen.findByRole('alert')).toHaveTextContent('No counts or response times are inferred');
  expect(screen.queryByText(/No alert records match/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry alert metric records' }));
  expect(await screen.findByText('#81: Historical gateway alert')).toBeInTheDocument();
});
it.each(['metric', 'days', 'query', 'total', 'records', 'timing_count'])('rejects mismatched %s', async field => {
  get.mockImplementation(async (_url, options) => { const value = data(options?.params as Record<string, unknown>); return { data: { ...value, [field]: field === 'records' ? [{ ...row, id: -1 }] : 'wrong' } }; });
  show(); expect(await screen.findByRole('alert')).toHaveTextContent('did not match');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('ignores old reads after a metric change', async () => {
  let resolveOld!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  show(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'resolved' } });
  await screen.findByText(/Current full-metric mean/);
  resolveOld({ data: { ...data({ metric: 'opened', days: 30, query: '', offset: 0, limit: 20 }), records: [{ ...row, title: 'Obsolete old read' }] } });
  await waitFor(() => expect(screen.queryByText(/Obsolete old read/)).not.toBeInTheDocument());
});
