import { MemoryRouter, useLocation } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { GlobalSearch } from './GlobalSearch';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);

const results = {
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
  const input = await screen.findByRole('combobox', { name: /Search alerts, investigations and assets/ });
  fireEvent.change(input, { target: { value: text } });
  await screen.findByText('Ransomware behavior on historian');
  return input;
}

describe('GlobalSearch', () => {
  it('queries the search endpoint and groups results by type', async () => {
    renderPalette();
    await typeQuery('ransomware');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/search', { params: { q: 'ransomware' } }));
    expect(screen.getByText('Alerts')).toBeTruthy();
    expect(screen.getByText('Investigations')).toBeTruthy();
    expect(screen.getByText('Assets')).toBeTruthy();
    expect(screen.getByText('Ransomware outbreak investigation')).toBeTruthy();
    expect(screen.getByText('plant-historian')).toBeTruthy();
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
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('/assets?search=plant-historian');
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
    const input = await screen.findByRole('combobox', { name: /Search alerts, investigations and assets/ });
    fireEvent.change(input, { target: { value: 'nothing-here' } });
    expect(await screen.findByText(/No alerts, investigations or assets match/)).toBeTruthy();
  });

  it('Escape closes the palette', async () => {
    const onClose = renderPalette();
    const input = await screen.findByRole('combobox', { name: /Search alerts, investigations and assets/ });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
