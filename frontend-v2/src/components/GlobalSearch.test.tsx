import { MemoryRouter, useLocation } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { GlobalSearch } from './GlobalSearch';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);

const results = {
  incidents: [{ asset_id: 11, asset_name: 'plant-historian', alert_count: 3, max_severity: 'critical' }],
  alerts: [{ id: 7, title: 'Ransomware behavior on historian', severity: 'critical', status: 'pending' }],
  cases: [{ id: 3, title: 'Ransomware outbreak investigation', status: 'open', severity: 'high' }],
  assets: [{ id: 11, name: 'plant-historian', vendor: 'Acme', asset_type: 'historian' }],
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderPalette() {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <GlobalSearch open onClose={onClose} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return onClose;
}

beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/search') return { data: { data: results } };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(cleanup);

async function typeQuery(text: string) {
  const input = await screen.findByRole('combobox', { name: /Search incidents, alerts, investigations and assets/ });
  fireEvent.change(input, { target: { value: text } });
  await screen.findByText('Ransomware behavior on historian');
  return input;
}

describe('GlobalSearch', () => {
  it('queries the search endpoint and groups results by type', async () => {
    renderPalette();
    await typeQuery('ransomware');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/search', { params: { q: 'ransomware' } }));
    expect(screen.getByText('Incidents')).toBeTruthy();
    expect(screen.getByText('Alerts')).toBeTruthy();
    expect(screen.getByText('Investigations')).toBeTruthy();
    expect(screen.getByText('Assets')).toBeTruthy();
    expect(screen.getByText('Ransomware outbreak investigation')).toBeTruthy();
    expect(screen.getAllByText('plant-historian')).toHaveLength(2); // incident + asset
    expect(screen.getByText(/3 active alerts/)).toBeTruthy();
  });

  it('navigates to the case workspace on click', async () => {
    const onClose = renderPalette();
    await typeQuery('ransomware');
    fireEvent.click(screen.getByText('Ransomware outbreak investigation'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/cases/3');
  });

  it('keyboard navigation moves through results and Enter opens the deep link', async () => {
    renderPalette();
    const input = await typeQuery('ransomware');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('/assets?asset=11');
  });

  it('deep-links an alert to the alerts page drawer param', async () => {
    renderPalette();
    await typeQuery('ransomware');
    fireEvent.click(screen.getByText('Ransomware behavior on historian'));
    expect(screen.getByTestId('location').textContent).toBe('/alerts?alert=7');
  });

  it('shows the empty state when nothing matches', async () => {
    get.mockResolvedValue({ data: { data: { alerts: [], cases: [], assets: [] } } });
    renderPalette();
    const input = await screen.findByRole('combobox', { name: /Search incidents, alerts, investigations and assets/ });
    fireEvent.change(input, { target: { value: 'nothing-here' } });
    expect(await screen.findByText(/No incidents, alerts, investigations, assets or saved events match/)).toBeTruthy();
  });

  it('navigates to the incidents page from an incident hit', async () => {
    const onClose = renderPalette();
    await typeQuery('ransomware');
    fireEvent.click(screen.getByText(/3 active alerts/));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/incidents?asset_id=11');
  });

  it('Escape closes the palette', async () => {
    const onClose = renderPalette();
    const input = await screen.findByRole('combobox', { name: /Search incidents, alerts, investigations and assets/ });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

it('removes old selectable hits while a different query is pending, including Enter', async () => {
  const onClose = renderPalette(); const input = await typeQuery('old-query');
  get.mockReturnValueOnce(new Promise(() => {})); fireEvent.change(input, { target: { value: 'new-query' } });
  expect(screen.queryByText('Ransomware behavior on historian')).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' }); expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText('Searching...')).toBeTruthy();
});
it('ignores a slow older reply after the current query completed', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; })); renderPalette();
  const input = screen.getByRole('combobox'); fireEvent.change(input, { target: { value: 'old-query' } });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  get.mockResolvedValueOnce({ data: { data: { alerts: [{ id: 45, title: 'New current result', severity: 'high', status: 'pending' }], cases: [], assets: [] } } });
  fireEvent.change(input, { target: { value: 'new-query' } }); await screen.findByText('New current result');
  resolve({ data: { data: results } }); await waitFor(() => expect(screen.queryByText('Ransomware behavior on historian')).toBeNull());
  fireEvent.click(screen.getByText('New current result')); expect(screen.getByTestId('location').textContent).toBe('/alerts?alert=45');
});
it('reports unavailability separately from no matches and retries the same search', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); renderPalette(); const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'gateway' } }); await screen.findByRole('alert');
  expect(screen.queryByText(/No incidents, alerts, investigations, assets or saved events match/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry workspace search' })); await screen.findByText('Ransomware behavior on historian');
  expect(get).toHaveBeenLastCalledWith('/search', { params: { q: 'gateway' } });
});
it('does not reuse pending results after closing and reopening', async () => {
  let resolve!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const { rerender } = render(<MemoryRouter><GlobalSearch open onClose={() => {}} /></MemoryRouter>);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'old-query' } }); await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  rerender(<MemoryRouter><GlobalSearch open={false} onClose={() => {}} /></MemoryRouter>);
  resolve({ data: { data: results } }); rerender(<MemoryRouter><GlobalSearch open onClose={() => {}} /></MemoryRouter>);
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe(''); expect(screen.queryByText('Ransomware behavior on historian')).toBeNull();
});
it('groups saved events and opens exact event evidence by mouse and keyboard', async () => {
  const event = { id: 90909, signature: 'Gateway protocol finding', severity: 'high', event_type: 'alert', timestamp: '2026-11-20T08:00:00Z', source_ip: null, dest_ip: '10.0.0.7' };
  get.mockResolvedValue({ data: { data: { alerts: [], cases: [], assets: [], events: [event] } } }); const onClose = renderPalette(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gateway' } });
  await screen.findByText('Gateway protocol finding'); expect(screen.getByText('Saved security events')).toBeTruthy(); expect(screen.getByText(/Source not recorded/)).toBeTruthy(); fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }); expect(screen.getByTestId('location').textContent).toBe('/events/90909'); expect(onClose).toHaveBeenCalledOnce();
});
it('uses an explicit event fallback and mouse navigation when signature is absent', async () => {
  get.mockResolvedValue({ data: { data: { alerts: [], cases: [], assets: [], events: [{ id: 99, signature: null, severity: 'info', event_type: 'dns', timestamp: 'now', source_ip: null, dest_ip: null }] } } }); renderPalette(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dns' } });
  fireEvent.click(await screen.findByRole('option', { name: /dns event #99/ })); expect(screen.getByTestId('location').textContent).toBe('/events/99');
});
it('does not display or navigate results echoed for another query', async () => {
  get.mockResolvedValue({ data: { data: { ...results, query: 'other query' } } }); renderPalette(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ransomware' } });
  await screen.findByRole('alert'); expect(screen.queryByRole('option')).toBeNull(); fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }); expect(screen.getByTestId('location').textContent).toBe('/');
});

it('offers encoded complete-search navigation after a successful bounded preview', async () => {
  get.mockResolvedValue({ data: { data: { ...results, totals: { alerts: 42, cases: 7, assets: 11, incidents: 6, events: 29 } } } });
  const close = renderPalette();
  await typeQuery('pump & 100%_');
  const link = screen.getByRole('link', { name: 'Explore all matching records' });
  expect(link.getAttribute('href')).toBe('/search?q=pump%20%26%20100%25_');
  expect(screen.getByText(/Full matching counts: alerts: 42/)).toBeTruthy();
  fireEvent.click(link);
  expect(close).toHaveBeenCalled();
  expect(screen.getByTestId('location').textContent).toBe('/search?q=pump%20%26%20100%25_');
});
