import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import type { Asset } from '../api/types';
import { Assets } from './Assets';

vi.mock('../api/client', () => ({ default: {
  get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(),
} }));

const asset: Asset = {
  id: 7, name: 'Plant gateway', asset_type: 'network_device', vendor: 'Acme',
  product: 'Gateway', version: '1.0', cpe_string: null, description: null,
  is_ot_asset: true, network_zone: 'plant', primary_protocol: null,
  criticality: 'high', created_at: '2026-11-17T08:00:00Z',
};
const get = vi.mocked(apiClient.get);
const remove = vi.mocked(apiClient.delete);
const put = vi.mocked(apiClient.put);

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { assets: [asset], total: 1 } });
  remove.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Assets page', () => {
  it('renders asset identity and OT badges', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    expect(await screen.findByText('Plant gateway')).toBeTruthy();
    expect(screen.getByText('Acme Gateway')).toBeTruthy();
    expect(screen.getByText('OT')).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('links to filtered alerts when the asset has open alerts', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/vendors/' || url === '/assets/types/') return { data: [] };
      return { data: { assets: [{ ...asset, open_alert_count: 3 }], total: 1 } };
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: '3 open alerts' });
    expect(link.getAttribute('href')).toBe('/alerts?asset_id=7');
  });

  it('shows a quiet no-open-alerts note at zero', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/vendors/' || url === '/assets/types/') return { data: [] };
      return { data: { assets: [{ ...asset, open_alert_count: 0 }], total: 1 } };
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    expect(await screen.findByText('No open alerts')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /open alert/i })).toBeNull();
  });

  it('searches the inventory with the entered query', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    await screen.findByText('Plant gateway');
    fireEvent.change(screen.getByPlaceholderText('Search assets...'), { target: { value: 'plant' } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/assets/', {
      params: { page: 1, size: 15, search: 'plant', sort: 'created_at_desc' },
    }));
  });

  it('filters by vendor from the dropdown', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/vendors/') return { data: ['Acme', 'Cisco'] };
      if (url === '/assets/types/') return { data: ['hardware'] };
      return { data: { assets: [asset], total: 1 } };
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Filter by vendor' });
    fireEvent.change(select, { target: { value: 'Cisco' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, vendor: 'Cisco', sort: 'created_at_desc' } });
    });
  });

  it('filters by criticality from the dropdown', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Filter by criticality' });
    fireEvent.change(select, { target: { value: 'high' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, criticality: 'high', sort: 'created_at_desc' } });
    });
  });

  it('filters to OT assets from the dropdown', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Filter by OT or IT' });
    fireEvent.change(select, { target: { value: 'true' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, is_ot: 'true', sort: 'created_at_desc' } });
    });
  });

  it('shows the risk badge when the asset has one', async () => {
    get.mockResolvedValue({ data: { assets: [{ ...asset, risk_score: 30, risk_level: 'high' }], total: 1, page: 1, size: 15 } });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    expect(await screen.findByText('Risk: high (30)')).toBeTruthy();
  });

  it('hides the risk badge when risk is none', async () => {
    get.mockResolvedValue({ data: { assets: [{ ...asset, risk_score: 0, risk_level: 'none' }], total: 1, page: 1, size: 15 } });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    await screen.findByText('Plant gateway');
    expect(screen.queryByText(/Risk:/)).toBeNull();
  });

  it('sends the risk sort order to the API', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Sort assets' });
    fireEvent.change(select, { target: { value: 'risk_desc' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, sort: 'risk_desc' } });
    });
  });

  it('sends the chosen sort order to the API', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Sort assets' });
    fireEvent.change(select, { target: { value: 'name_asc' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, sort: 'name_asc' } });
    });
  });

  it('filters by asset type from the dropdown', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    await screen.findByText('Plant gateway');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by asset type' }), { target: { value: 'plc' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/assets/', { params: { page: 1, size: 15, asset_type: 'plc', sort: 'created_at_desc' } });
    });
  });

  it('asks for confirmation and does not delete when cancelled', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Plant gateway' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Delete asset?')).toBeTruthy();
    expect(dialog.getByText(/Plant gateway will be removed/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a confirmed asset and refreshes inventory', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Plant gateway' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Delete asset' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('/assets/7');
      expect(get.mock.calls.filter(([url]) => url === '/assets/').length).toBe(2);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('labels the search input and the asset form fields for assistive tech', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    expect(await screen.findByRole('textbox', { name: 'Search assets' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /add asset/i }));
    const dialog = await screen.findByRole('dialog');
    for (const label of ['Asset name', 'Vendor', 'Product', 'Version', 'Asset type', 'Criticality']) {
      expect(within(dialog).getByLabelText(label)).toBeTruthy();
    }
  });

  it('prefills the edit dialog and saves the changed name', async () => {
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Plant gateway' }));
    const dialog = within(screen.getByRole('dialog'));
    const name = dialog.getByPlaceholderText('Name') as HTMLInputElement;
    expect(name.value).toBe('Plant gateway');
    fireEvent.change(name, { target: { value: 'Updated gateway' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Update' }));
    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/assets/7', expect.objectContaining({ name: 'Updated gateway' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('Asset type options', () => {
  it('loads the valid types from the API instead of the stale hardcoded list', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/types/') return { data: ['hardware', 'software', 'firmware', 'operating_system', 'plc', 'hmi', 'rtu', 'ied', 'scada_server', 'historian'] };
      return { data: { assets: [asset], total: 1 } };
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Plant gateway' }));
    const dialog = within(screen.getByRole('dialog'));
    const select = await dialog.findByLabelText('Asset type');
    const options = Array.from((select as HTMLSelectElement).options).map(o => o.value);
    expect(options).toEqual(['hardware', 'software', 'firmware', 'operating_system', 'plc', 'hmi', 'rtu', 'ied', 'scada_server', 'historian']);
    expect(options).not.toContain('scada');
    expect(options).not.toContain('other_ot');
    expect(dialog.getByText('SCADA Server')).toBeTruthy();
    expect(dialog.getByText('Operating System')).toBeTruthy();
    expect(dialog.getByText('IED')).toBeTruthy();
  });

  it('keeps a valid fallback list when the types endpoint fails', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/assets/types/') throw new Error('down');
      return { data: { assets: [asset], total: 1 } };
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Plant gateway' }));
    const dialog = within(screen.getByRole('dialog'));
    const select = dialog.getByLabelText('Asset type');
    const options = Array.from((select as HTMLSelectElement).options).map(o => o.value);
    expect(options).toContain('scada_server');
    expect(options).not.toContain('scada');
  });
});

describe('Assets CSV export', () => {
  it('downloads the CSV with the active filters', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:assets');
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreate(tag, options);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', { set: (v: string) => clicks.push(v), configurable: true });
        el.click = () => clicks.push('clicked');
      }
      return el;
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    await screen.findByRole('button', { name: /export csv/i });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by criticality' }), { target: { value: 'high' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort assets' }), { target: { value: 'name_asc' } });
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/export', { params: { criticality: 'high', sort: 'name_asc' }, responseType: 'blob' }));
    await waitFor(() => expect(clicks).toContain('assets.csv'));
  });
});

describe('Assets deep link', () => {
  it('pre-fills the inventory search from the ?search= param', async () => {
    render(<MemoryRouter initialEntries={['/assets?search=historian']}><Assets /></MemoryRouter>);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/', expect.objectContaining({ params: expect.objectContaining({ search: 'historian' }) })));
    expect((screen.getByRole('textbox', { name: 'Search assets' }) as HTMLInputElement).value).toBe('historian');
  });
});

describe('Asset inventory pagination', () => {
  function pagedInventory(total = 31) {
    get.mockImplementation(async (url, config) => {
      if (url !== '/assets/') return { data: [] };
      const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
      return { data: { assets: [{ ...asset, name: `Gateway page ${page}` }], total, page, size: 15 } };
    });
  }

  it('reaches later pages and returns without losing the selected ordering', async () => {
    pagedInventory();
    render(<MemoryRouter><Assets /></MemoryRouter>);
    await screen.findByText('Gateway page 1');
    expect((screen.getByRole('button', { name: 'Previous assets' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Sort assets'), { target: { value: 'name_asc' } });
    await screen.findByText('Gateway page 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next assets' }));
    expect(await screen.findByText('Gateway page 2')).toBeTruthy();
    expect(get).toHaveBeenLastCalledWith('/assets/', { params: { page: 2, size: 15, sort: 'name_asc' } });
    expect(screen.getByText('Showing 16–30 of 31 matching assets · Page 2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next assets' }));
    expect(await screen.findByText('Gateway page 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next assets' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous assets' }));
    expect(await screen.findByText('Gateway page 2')).toBeTruthy();
  });

  it('resets to the first page when a filter changes', async () => {
    pagedInventory();
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Next assets' }));
    await screen.findByText('Gateway page 2');
    fireEvent.change(screen.getByLabelText('Filter by criticality'), { target: { value: 'high' } });
    expect(await screen.findByText('Gateway page 1')).toBeTruthy();
    expect(get).toHaveBeenLastCalledWith('/assets/', { params: { page: 1, size: 15, criticality: 'high', sort: 'created_at_desc' } });
  });

  it('keeps a failed page load explicit and retries the same page', async () => {
    let fail = true;
    get.mockImplementation(async (url, config) => {
      if (url !== '/assets/') return { data: [] };
      const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
      if (page === 2 && fail) throw new Error('Page unavailable');
      return { data: { assets: [{ ...asset, name: `Gateway page ${page}` }], total: 16 } };
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Next assets' }));
    expect(await screen.findByText('Asset inventory unavailable')).toBeTruthy();
    expect(screen.queryByText('Gateway page 1')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Asset inventory pages' })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Gateway page 2')).toBeTruthy();
  });

  it('returns to the last existing page when deletion empties a later page', async () => {
    let total = 16;
    get.mockImplementation(async (url, config) => {
      if (url !== '/assets/') return { data: [] };
      const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
      return { data: { assets: total === 15 && page === 2 ? [] : [{ ...asset, name: `Gateway page ${page}` }], total } };
    });
    remove.mockImplementation(async () => { total = 15; return { data: {} }; });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Next assets' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Gateway page 2' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete asset' }));
    expect(await screen.findByText('Gateway page 1')).toBeTruthy();
    expect(screen.getByText('Showing 1–15 of 15 matching assets · Page 1 of 1')).toBeTruthy();
  });

  it('ignores a slower earlier filter result after a newer filter loads', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementation((url, config) => {
      if (url !== '/assets/') return Promise.resolve({ data: [] });
      if ((config?.params as { search?: string } | undefined)?.search === 'old') return new Promise(resolve => { resolveOld = resolve; });
      return Promise.resolve({ data: { assets: [{ ...asset, name: 'Current gateway' }], total: 1 } });
    });
    render(<MemoryRouter><Assets /></MemoryRouter>);
    await screen.findByText('Current gateway');
    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'new' } });
    await screen.findByText('Current gateway');
    await act(async () => { resolveOld({ data: { assets: [{ ...asset, name: 'Stale gateway' }], total: 100 } }); });
    await waitFor(() => expect(screen.queryByText('Stale gateway')).toBeNull());
    expect(screen.getByText('Showing 1–1 of 1 matching assets · Page 1 of 1')).toBeTruthy();
  });
});


it('opens read-only current asset context from the inventory name', async () => {
  get.mockImplementation(async url => {
    if (url === '/assets/7') return { data: { ...asset, last_known_ip: '192.0.2.10' } };
    if (url === '/assets/') return { data: { assets: [asset], total: 1 } };
    return { data: [] };
  });
  render(<MemoryRouter><Assets /></MemoryRouter>);
  const opener = await screen.findByRole('button', { name: 'View details for Plant gateway' });
  opener.focus();
  fireEvent.click(opener);
  expect(await screen.findByText('192.0.2.10')).toBeTruthy();
  expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe('asset-inspector-heading');
  fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View details for Plant gateway' }));
});

it('reviews only selected loaded assets and saves just criticality after confirmation', async () => {
  get.mockImplementation(async (url: string) => url === '/assets/' ? { data: { assets: [{ ...asset, risk_score: 20, risk_level: 'high' }], total: 1 } } : { data: [] });
  put.mockResolvedValue({ data: { ...asset, criticality: 'critical' } });
  render(<MemoryRouter><Assets /></MemoryRouter>);
  await screen.findByText('Plant gateway');
  fireEvent.click(screen.getByRole('button', { name: 'Review page criticality' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select this asset page' }));
  fireEvent.change(screen.getByLabelText('New asset criticality'), { target: { value: 'critical' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review criticality change' }));
  expect(put).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain('Only the criticality field is edited');
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 assets' }));
  await screen.findByText(/Confirmed criticality changes for 1 of 1/);
  expect(put).toHaveBeenCalledWith('/assets/7', { criticality: 'critical' });
  expect(screen.getByText('critical')).toBeTruthy();
  expect(screen.queryByText('Risk: high (20)')).toBeNull();
});

it('preserves failed or unconfirmed changes for review and retry', async () => {
  get.mockImplementation(async (url: string) => url === '/assets/'
    ? { data: { assets: [asset, { ...asset, id: 8, name: 'Second asset' }], total: 2 } }
    : { data: [] });
  put.mockImplementation(async (url: string) => ({ data: url === '/assets/7' ? { ...asset, criticality: 'low' } : { id: 8, criticality: 'high' } }));
  render(<MemoryRouter><Assets /></MemoryRouter>);
  await screen.findByText('Plant gateway');
  fireEvent.click(screen.getByRole('button', { name: 'Review page criticality' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select this asset page' }));
  fireEvent.change(screen.getByLabelText('New asset criticality'), { target: { value: 'low' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review criticality change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 assets' }));
  await screen.findByText(/Confirmed criticality changes for 1 of 2/);
  expect(screen.getByText(/1 of 2 loaded-page assets selected/)).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: 'Select criticality for Second asset' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: 'Select criticality for Plant gateway' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(/The server did not confirm/)).toBeTruthy();
});

it('locks navigation and edits while criticality is being saved', async () => {
  let finish!: (value: unknown) => void;
  put.mockReturnValue(new Promise(resolve => { finish = resolve; }) as ReturnType<typeof apiClient.put>);
  render(<MemoryRouter><Assets /></MemoryRouter>);
  await screen.findByText('Plant gateway');
  fireEvent.click(screen.getByRole('button', { name: 'Review page criticality' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select this asset page' }));
  fireEvent.change(screen.getByLabelText('New asset criticality'), { target: { value: 'low' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review criticality change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 assets' }));
  expect((screen.getByRole('button', { name: 'Edit Plant gateway' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Hide criticality review' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ data: { ...asset, criticality: 'low' } }));
  await screen.findByText(/Confirmed criticality changes for 1 of 1/);
});

it('keeps comparison choices across inventory pages and filters, then reads exact assets without writes', async () => {
  const other = { ...asset, id: 29, name: 'Second gateway', firmware_version: '2.0' };
  get.mockImplementation(async (url, config) => {
    if (url === '/assets/vendors/' || url === '/assets/types/') return { data: [] };
    if (url === '/assets/7') return { data: asset };
    if (url === '/assets/29') return { data: other };
    return { data: { assets: [(config?.params as { page: number; search?: string }).page === 2 || (config?.params as { search?: string }).search ? other : asset], total: 30 } };
  });
  render(<MemoryRouter><Assets /></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('Select asset 7 for comparison'));
  fireEvent.click(screen.getByRole('button', { name: 'Next assets' }));
  fireEvent.click(await screen.findByLabelText('Select asset 29 for comparison'));
  fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'Second' } });
  await waitFor(() => expect(screen.getByText('Asset selection: #7 → #29')).toBeTruthy());
  const before = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Load selected asset comparison' }));
  await screen.findByText(/2 of 23 shown inventory fields differ/);
  expect(get.mock.calls.slice(before).map(call => call[0])).toEqual(['/assets/7', '/assets/29']);
  expect(put).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled();
});
