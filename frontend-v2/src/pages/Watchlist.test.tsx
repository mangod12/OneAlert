import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Watchlist } from './Watchlist';

vi.mock('../api/client', () => ({
  SESSION_EXPIRED_EVENT: 'onealert:session-expired',
  default: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockDelete = vi.mocked(apiClient.delete);

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 5,
    cve_id: 'CVE-2026-0001',
    title: 'RouterOS remote code execution',
    severity: 'high',
    status: 'pending',
    asset_name: 'edge-router-01',
    created_at: '2026-11-10T08:00:00Z',
    ...overrides,
  };
}

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    title: 'Intrusion on the edge network',
    severity: 'critical',
    status: 'open',
    created_at: '2026-11-12T08:00:00Z',
    due_date: null,
    ...overrides,
  };
}

function mockFeed(alerts: unknown[] = [], cases: unknown[] = []) {
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/alerts/') return { data: { alerts, total: alerts.length, page: 1, size: 50, pages: 1 } };
    if (url === '/cases/') return { data: { cases, total: cases.length, page: 1, pages: 1 } };
    return { data: [] };
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockFeed([makeAlert()], [makeCase()]);
  mockDelete.mockResolvedValue({ data: {} });
});

describe('Watchlist page', () => {
  it('asks both endpoints for watched items', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Intrusion on the edge network');
    expect(mockGet).toHaveBeenCalledWith('/alerts/', { params: { watching: 'me', size: 50, page: 1 } });
    expect(mockGet).toHaveBeenCalledWith('/cases/', { params: { watching: 'me', size: 50, page: 1 } });
  });

  it('merges alerts and investigations ranked by severity', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Intrusion on the edge network');
    const rows = screen.getAllByRole('row').slice(1); // skip the header row
    expect(rows[0].textContent).toContain('Intrusion on the edge network'); // critical case first
    expect(rows[1].textContent).toContain('CVE-2026-0001 - RouterOS remote code execution'); // high alert second
    expect(rows[1].textContent).toContain('edge-router-01');
  });

  it('marks overdue investigations', async () => {
    mockFeed([], [makeCase({ due_date: '2020-01-01' })]);
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText(/Due 2020-01-01 \(overdue\)/);
  });

  it('shows the empty state when nothing is watched', async () => {
    mockFeed([], []);
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Nothing on your watchlist');
  });

  it('shows the error state and retries', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Watchlist unavailable');
    mockFeed([makeAlert()], []);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await screen.findByText(/CVE-2026-0001/);
  });

  it('unwatches an alert from the list', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText(/CVE-2026-0001/);
    fireEvent.click(screen.getByRole('button', { name: /unwatch CVE-2026-0001/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/alerts/1/watch'));
    await waitFor(() => expect(screen.queryByText(/CVE-2026-0001/)).toBeNull());
    // The investigation stays on the list.
    screen.getByText('Intrusion on the edge network');
  });

  it('unwatches an investigation from the list', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText('Intrusion on the edge network');
    fireEvent.click(screen.getByRole('button', { name: /unwatch Intrusion/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cases/3/watch'));
    await waitFor(() => expect(screen.queryByText('Intrusion on the edge network')).toBeNull());
  });

  it('keeps the row when unwatching fails', async () => {
    mockDelete.mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByText(/CVE-2026-0001/);
    fireEvent.click(screen.getByRole('button', { name: /unwatch CVE-2026-0001/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    await screen.findByText(/CVE-2026-0001/);
  });

  it('deep-links alert rows to the alerts page and case rows to the investigation', async () => {
    render(
      <MemoryRouter initialEntries={['/watchlist']}>
        <Routes>
          <Route path="*" element={<><Watchlist /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    );
    const caseName = await screen.findByText('Intrusion on the edge network');
    expect((caseName.closest('a') as HTMLAnchorElement).getAttribute('href')).toBe('/cases/3');
    const alertLink = screen.getByRole('link', { name: /CVE-2026-0001/ });
    expect(alertLink.getAttribute('href')).toBe('/alerts?alert=1');
    fireEvent.click(caseName.closest('a')!);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/cases/3'));
  });
  it('loads later pages, deduplicates records and ranks loaded items only', async () => {
    mockGet.mockImplementation(async (url, config) => {
      const page = (config?.params as { page?: number }).page;
      if (url === '/alerts/') return { data: { alerts: page === 1 ? [makeAlert()] : [makeAlert(), makeAlert({ id: 2, title: 'Later critical alert', cve_id: null, severity: 'critical' })], total: 51 } };
      return { data: { cases: [], total: 0 } };
    });
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more watched items' }));
    expect(await screen.findByText('Later critical alert')).toBeTruthy();
    expect(screen.getAllByText('CVE-2026-0001 - RouterOS remote code execution')).toHaveLength(1);
    expect(screen.getAllByRole('row')[1].textContent).toContain('Later critical alert');
    expect(screen.queryByRole('button', { name: 'Load more watched items' })).toBeNull();
    expect(mockGet).toHaveBeenCalledWith('/alerts/', { params: { watching: 'me', size: 50, page: 2 } });
  });

  it('retains loaded items and retries the same page after a later failure', async () => {
    let fail = true;
    mockGet.mockImplementation(async (url, config) => {
      const page = (config?.params as { page?: number }).page;
      if (page === 2 && fail) throw new Error('Offline');
      if (url === '/alerts/') return { data: { alerts: page === 1 ? [makeAlert()] : [makeAlert({ id: 2, title: 'Later alert', cve_id: null })], total: page === 1 ? 51 : 2 } };
      return { data: { cases: [], total: 0 } };
    });
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more watched items' }));
    await screen.findByRole('alert');
    expect(screen.getByText('CVE-2026-0001 - RouterOS remote code execution')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Load more watched items' }));
    expect(await screen.findByText('Later alert')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

});


describe('Watchlist loaded-record triage', () => {
  it('searches CVE, asset and record ID without changing endpoint scope', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    const input = await screen.findByLabelText('Find watched items');
    fireEvent.change(input, { target: { value: 'EDGE-ROUTER' } });
    expect(screen.queryByText('Intrusion on the edge network')).toBeNull();
    expect(screen.getByText(/RouterOS remote code execution/)).toBeTruthy();
    fireEvent.change(input, { target: { value: 'CVE-2026-0001' } });
    expect(screen.getByText('1 of 2 loaded items match.', { exact: false })).toBeTruthy();
    fireEvent.change(input, { target: { value: '3' } });
    expect(screen.getByText('Intrusion on the edge network')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('combines type, severity and lifecycle, then clears the view', async () => {
    mockFeed([makeAlert()], [makeCase(), makeCase({ id: 4, title: 'Closed case', status: 'closed' }), makeCase({ id: 5, title: 'False positive case', status: 'false_positive' })]);
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByLabelText('Find watched items');
    fireEvent.change(screen.getByLabelText('Watched item type'), { target: { value: 'case' } });
    fireEvent.change(screen.getByLabelText('Watched severity'), { target: { value: 'critical' } });
    fireEvent.change(screen.getByLabelText('Watched work scope'), { target: { value: 'done' } });
    expect(screen.getByText('Closed case')).toBeTruthy();
    expect(screen.getByText('False positive case')).toBeTruthy();
    expect(screen.queryByText('Intrusion on the edge network')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear watchlist filters' }));
    expect(screen.getByText('Intrusion on the edge network')).toBeTruthy();
    expect(screen.getByText(/RouterOS remote code execution/)).toBeTruthy();
  });

  it('shows only active overdue investigations, not completed ones or future work', async () => {
    mockFeed([makeAlert()], [makeCase({ due_date: '2020-01-01' }), makeCase({ id: 4, title: 'Closed overdue case', due_date: '2020-01-01', status: 'closed' }), makeCase({ id: 5, title: 'Future case', due_date: '2099-01-01' })]);
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByLabelText('Find watched items');
    fireEvent.change(screen.getByLabelText('Watched work scope'), { target: { value: 'overdue' } });
    expect(screen.getByText('Intrusion on the edge network')).toBeTruthy();
    expect(screen.queryByText('Closed overdue case')).toBeNull();
    expect(screen.queryByText('Future case')).toBeNull();
    expect(screen.queryByText(/RouterOS remote code execution/)).toBeNull();
    expect(screen.getByText(/Alert due dates are not included/)).toBeTruthy();
  });

  it('sorts the loaded rows by creation date and name without mutating the severity default', async () => {
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    await screen.findByLabelText('Find watched items');
    fireEvent.change(screen.getByLabelText('Watched item order'), { target: { value: 'oldest' } });
    expect(screen.getAllByRole('row')[1].textContent).toContain('RouterOS');
    fireEvent.change(screen.getByLabelText('Watched item order'), { target: { value: 'newest' } });
    expect(screen.getAllByRole('row')[1].textContent).toContain('Intrusion');
    fireEvent.change(screen.getByLabelText('Watched item order'), { target: { value: 'name' } });
    expect(screen.getAllByRole('row')[1].textContent).toContain('CVE-2026-0001');
    fireEvent.click(screen.getByRole('button', { name: 'Clear watchlist filters' }));
    expect(screen.getAllByRole('row')[1].textContent).toContain('Intrusion');
  });

  it('keeps load-more reachable with no current matches and applies filters to later pages', async () => {
    mockGet.mockImplementation(async (url, config) => {
      const page = (config?.params as { page?: number }).page;
      if (url === '/alerts/') return { data: { alerts: [makeAlert(page === 2 ? { id: 2, title: 'Later needle alert' } : {})], total: 51 } };
      return { data: { cases: [], total: 0 } };
    });
    render(<MemoryRouter><Watchlist /></MemoryRouter>);
    const input = await screen.findByLabelText('Find watched items');
    fireEvent.change(input, { target: { value: 'needle' } });
    expect(screen.getByText(/No loaded items match/)).toBeTruthy();
    expect(screen.queryByText('Nothing on your watchlist')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load more watched items' }));
    await screen.findByText('CVE-2026-0001 - Later needle alert');
    expect(screen.getByText(/1 of 2 loaded items match/)).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('needle');
    fireEvent.click(screen.getByRole('button', { name: /Unwatch CVE-2026-0001 - Later/ }));
    await waitFor(() => expect(screen.queryByText('CVE-2026-0001 - Later needle alert')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Clear watchlist filters' }));
    expect(screen.getByText(/RouterOS remote code execution/)).toBeTruthy();
  });
});

it('previews mixed-type selection including hidden records and requires confirmation before unwatching', async () => {
  render(<MemoryRouter><Watchlist /></MemoryRouter>);
  await screen.findByText('Intrusion on the edge network');
  fireEvent.click(screen.getByRole('button', { name: 'Select matching watched items' }));
  fireEvent.change(screen.getByLabelText('Watched item type'), { target: { value: 'alert' } });
  expect(screen.getByText(/2 loaded records selected; 1 hidden/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mockDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Unwatch 2 records' }));
  await screen.findByText(/Unwatched 2 of 2/);
  expect(mockDelete).toHaveBeenCalledWith('/alerts/1/watch');
  expect(mockDelete).toHaveBeenCalledWith('/cases/3/watch');
  expect(screen.getByText('Nothing on your watchlist')).toBeTruthy();
});

it('keeps failed bulk unwatch records selected and retries only failures', async () => {
  mockDelete.mockImplementation(async (url: string) => {
    if (url === '/cases/3/watch') throw new Error('Not saved');
    return { data: {} };
  });
  render(<MemoryRouter><Watchlist /></MemoryRouter>);
  await screen.findByText('Intrusion on the edge network');
  fireEvent.click(screen.getByRole('button', { name: 'Select matching watched items' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unwatch 2 records' }));
  await screen.findByText(/Unwatched 1 of 2/);
  expect(screen.getByText(/1 loaded records selected; 0 hidden/)).toBeTruthy();
  expect(screen.getByText('Not saved')).toBeTruthy();
  mockDelete.mockResolvedValue({ data: {} });
  fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unwatch 1 records' }));
  await screen.findByText(/Unwatched 1 of 1/);
  expect(mockDelete).toHaveBeenCalledTimes(3);
  expect(mockDelete).toHaveBeenLastCalledWith('/cases/3/watch');
});

it('can cancel bulk unwatch without changing followed records', async () => {
  render(<MemoryRouter><Watchlist /></MemoryRouter>);
  await screen.findByText('Intrusion on the edge network');
  fireEvent.click(screen.getByRole('button', { name: 'Select matching watched items' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockDelete).not.toHaveBeenCalled();
  expect(screen.getByText(/2 loaded records selected/)).toBeTruthy();
});

it('keeps overlapping alert and case IDs separate during selection', async () => {
  mockFeed([makeAlert({ id: 3 })], [makeCase()]);
  render(<MemoryRouter><Watchlist /></MemoryRouter>);
  await screen.findByText('Intrusion on the edge network');
  fireEvent.click(screen.getByRole('checkbox', { name: /Select alert #3/ }));
  expect(screen.getByRole('checkbox', { name: /Select case #3/ }).getAttribute('checked')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unwatch 1 records' }));
  await screen.findByText(/Unwatched 1 of 1/);
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledWith('/alerts/3/watch');
  expect(screen.getByText('Intrusion on the edge network')).toBeTruthy();
});

it('requires a first-page reload after removals so shifted later pages are not skipped', async () => {
  mockGet.mockImplementation(async (url: string) => url === '/alerts/'
    ? { data: { alerts: [makeAlert()], total: 51 } }
    : { data: { cases: [], total: 0 } });
  render(<MemoryRouter><Watchlist /></MemoryRouter>);
  await screen.findByText('CVE-2026-0001 - RouterOS remote code execution');
  fireEvent.click(screen.getByRole('button', { name: 'Select matching watched items' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected unwatch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unwatch 1 records' }));
  await screen.findByText(/Unwatched 1 of 1/);
  expect((screen.getByRole('button', { name: 'Load more watched items' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload watched items from first page' }));
  await screen.findByText('CVE-2026-0001 - RouterOS remote code execution');
  expect(mockGet).toHaveBeenLastCalledWith('/cases/', { params: { watching: 'me', size: 50, page: 1 } });
  expect((screen.getByRole('button', { name: 'Load more watched items' }) as HTMLButtonElement).disabled).toBe(false);
});
