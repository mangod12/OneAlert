import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HuntQueryEvidence } from './HuntQueryEvidence';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const rows = Array.from({ length: 45 }, (_, index) => ({ host: `host-${index + 1}`, count: index }));

describe('Retained hunt query evidence', () => {
  it('reviews every retained row without claiming unretained results are available', () => {
    render(<HuntQueryEvidence index={0} result={{ row_count: 120, rows }} />);
    expect(screen.getByText('120 results reported · 45 evidence rows retained')).toBeTruthy();
    expect(screen.getByText('host-20')).toBeTruthy();
    expect(screen.queryByText('host-21')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next rows for query 1' }));
    expect(screen.getByText('host-21')).toBeTruthy();
    expect(screen.queryByText('host-20')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next rows for query 1' }));
    expect(screen.getByText('host-45')).toBeTruthy();
    expect(screen.getByText('Showing 41–45 of 45 retained rows · Page 3 of 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next rows for query 1' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/75 reported rows were not retained/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous rows for query 1' }));
    expect(screen.getByText('host-21')).toBeTruthy();
  });
  it('aligns heterogeneous row fields by column name, including later-only fields and nested data', () => {
    render(<HuntQueryEvidence index={0} result={{ rows: [{ host: 'A', count: 0 }, { count: 8, host: 'B', detail: { port: 502 } }] }} />);
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['host', 'count', 'detail']);
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(within(bodyRows[0]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['A', '0', 'Not recorded']);
    expect(within(bodyRows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['B', '8', '{"port":502}']);
  });
  it('states missing counts and SQL and exposes saved query errors', () => {
    render(<HuntQueryEvidence index={1} result={{ error: 'Recorded query failed' }} />);
    expect(screen.getByText('Result count not recorded · 0 evidence rows retained')).toBeTruthy();
    expect(screen.getByText('SQL not recorded')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Recorded query failed');
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('keeps each query page independent', () => {
    render(<><HuntQueryEvidence index={0} result={{ rows }} /><HuntQueryEvidence index={1} result={{ rows }} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Next rows for query 1' }));
    expect(within(screen.getByRole('region', { name: 'Query 1 evidence' })).getByText('host-21')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Query 2 evidence' })).getByText('host-1')).toBeTruthy();
  });
});

it('shows exact saved inclusive/exclusive UTC bounds and original parameters without recalculating them', () => {
  render(<HuntQueryEvidence index={0} result={{ time_window: { since: '2026-11-20T05:00:00+00:00', before: '2026-11-20T06:00:00+00:00' }, query: { sql: 'SELECT id ...', params: { since: '2026-11-20T10:30:00+05:30', before: '2026-11-20T06:00:00Z' } }, rows: [] }} />);
  expect(screen.getByText('From, inclusive: 2026-11-20T05:00:00+00:00')).toBeTruthy();
  expect(screen.getByText('Before, exclusive: 2026-11-20T06:00:00+00:00')).toBeTruthy();
  expect(screen.getByText(/not a new time window or live check/)).toBeTruthy();
  fireEvent.click(screen.getByText('Recorded query parameters'));
  expect(screen.getByText(/2026-11-20T10:30:00\+05:30/)).toBeTruthy();
});

it('distinguishes known unbounded execution from missing legacy bound evidence', () => {
  const view = render(<HuntQueryEvidence index={0} result={{ time_window: {}, rows: [] }} />);
  expect(screen.getByText('No event-time bounds were applied to this query.')).toBeTruthy();
  view.rerender(<HuntQueryEvidence index={0} result={{ rows: [] }} />);
  expect(screen.queryByText('No event-time bounds were applied to this query.')).toBeNull();
  expect(screen.getByText('Applied event-time bounds were not recorded for this result.')).toBeTruthy();
});

it('shows applied fields, stable order and effective cap separately from the request', () => {
  render(<HuntQueryEvidence index={0} result={{ execution: {
    contract: 'scoped_select_v1', selected_columns: ['id', 'timestamp', 'severity'],
    order_by: 'timestamp', direction: 'DESC', tie_breaker: { column: 'id', direction: 'DESC' },
    requested_limit: 500, row_limit: 100,
  }, rows: [] }} />);
  expect(screen.getByLabelText('Applied query execution').textContent).toContain('Selected fields: id, timestamp, severity');
  expect(screen.getByLabelText('Applied query execution').textContent).toContain('Order: timestamp DESC, then id DESC');
  expect(screen.getByLabelText('Applied query execution').textContent).toContain('Row limit: 100 (requested 500)');
  expect(screen.getByLabelText('Applied query execution').textContent).toContain('scoped_select_v1');
});

it('does not invent applied selection or row limits for legacy results', () => {
  render(<HuntQueryEvidence index={0} result={{ query: { sql: 'SELECT * FROM security_events LIMIT 500' }, rows: [{ id: 1 }] }} />);
  expect(screen.queryByLabelText('Applied query execution')).toBeNull();
  expect(screen.getByText('Applied selection, order and row limit were not recorded for this result.')).toBeTruthy();
});

it('distinguishes a default row limit from an explicit request', () => {
  render(<HuntQueryEvidence index={0} result={{ execution: {
    contract: 'scoped_select_v1', selected_columns: ['id'], order_by: 'id', direction: 'ASC',
    requested_limit: null, row_limit: 100,
  }, rows: [] }} />);
  expect(screen.getByLabelText('Applied query execution').textContent).toContain('Row limit: 100 (default)');
  expect(screen.getByLabelText('Applied query execution').textContent).not.toContain('then id');
});

it('searches all retained pages using literal nested values, preserves zero and resets page on filters',()=>{
  const evidence=[...rows,{host:'late-special',detail:{literal:'100%_match'},count:0,missing:null}];render(<HuntQueryEvidence index={0} result={{row_count:120,rows:evidence}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Next rows for query 1'}));fireEvent.change(screen.getByLabelText('Search retained rows for query 1'),{target:{value:'100%_MATCH'}});expect(screen.getByText('late-special')).toBeTruthy();expect(screen.getByText('1 of 46 retained rows match.')).toBeTruthy();expect(screen.getByText(/74 reported rows were not retained/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search field for query 1'),{target:{value:'host'}});expect(screen.getByText(/No retained rows match this local search/)).toBeTruthy();expect(screen.getByRole('button',{name:'Export matching retained rows CSV'})).toHaveProperty('disabled',true);
  fireEvent.change(screen.getByLabelText('Search retained rows for query 1'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('Search field for query 1'),{target:{value:'count'}});expect(screen.getByText('6 of 46 retained rows match in count.')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Clear retained row search'}));expect(screen.getByText('host-1')).toBeTruthy();expect(screen.getByText('Showing 1–20 of 46 retained rows · Page 1 of 3')).toBeTruthy();
});

it('downloads full retained query JSON despite local search and paging without changing review', async () => {
 const blobs: Blob[] = []; vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:hunt'; }), revokeObjectURL: vi.fn() }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('hunt-query-1-retained-evidence.json'); }); render(<HuntQueryEvidence index={0} result={{ outcome: 'completed', row_count: 120, rows }} />); fireEvent.click(screen.getByRole('button', { name: 'Next rows for query 1' })); fireEvent.change(screen.getByLabelText('Search retained rows for query 1'), { target: { value: 'no match' } }); expect(blobs).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Export retained query JSON' })); expect(click).toHaveBeenCalledOnce(); const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]); }); const value = JSON.parse(text); expect(value.result.rows).toEqual(rows); expect(value.result.reported_row_count).toBe(120); expect(screen.getByLabelText('Search retained rows for query 1')).toHaveProperty('value', 'no match'); expect(screen.getByRole('region', { name: 'Query 1 evidence' })).toBeTruthy();
});

it('exports typed matching JSON across pages using the selected field and disables zero matches', async () => {
 const blobs: Blob[] = []; const names: string[] = []; vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:matching'; }), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { names.push(this.download); }); const data = Array.from({ length: 45 }, (_, id) => ({ id, detail: { flag: false }, host: `host-${id}` })); render(<HuntQueryEvidence index={0} result={{ row_count: 120, rows: data }} />); expect(screen.queryByRole('button', { name: 'Export matching retained query JSON' })).toBeNull(); fireEvent.change(screen.getByLabelText('Search field for query 1'), { target: { value: 'detail' } }); fireEvent.change(screen.getByLabelText('Search retained rows for query 1'), { target: { value: ' FALSE ' } }); fireEvent.click(screen.getByRole('button', { name: 'Next rows for query 1' })); fireEvent.click(screen.getByRole('button', { name: 'Export matching retained query JSON' })); expect(names).toEqual(['hunt-query-1-matching-retained-evidence.json']); const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]); }); const value = JSON.parse(text); expect(value.result.rows).toEqual(data); expect(value.retained_search).toEqual({ text: 'FALSE', field: 'detail', retained_total: 45 }); expect(value.result.reported_row_count).toBe(120); fireEvent.change(screen.getByLabelText('Search field for query 1'), { target: { value: 'host' } }); expect(screen.getByRole('button', { name: 'Export matching retained query JSON' })).toHaveProperty('disabled', true); expect(screen.getByRole('button', { name: 'Export retained query JSON' })).toHaveProperty('disabled', false);
});

it('sorts safe numeric retained IDs across pages and search without mutating retained rows', () => {
 const data = Array.from({ length: 45 }, (_, i) => ({ id: 45 - i, host: `host-${45 - i}` })), before = JSON.stringify(data); render(<HuntQueryEvidence index={0} result={{ rows: data }} />); const first = () => within(screen.getAllByRole('row')[1]).getAllByRole('cell')[0].textContent; expect(first()).toBe('45'); fireEvent.click(screen.getByRole('button', { name: 'Next rows for query 1' })); fireEvent.change(screen.getByLabelText('Retained row inspection order for query 1'), { target: { value: 'id-asc' } }); expect(first()).toBe('1'); expect(screen.getByText('Showing 1–20 of 45 retained rows · Page 1 of 3')).toBeTruthy(); fireEvent.change(screen.getByLabelText('Search retained rows for query 1'), { target: { value: 'host-2' } }); expect(first()).toBe('2'); fireEvent.change(screen.getByLabelText('Retained row inspection order for query 1'), { target: { value: 'id-desc' } }); expect(first()).toBe('29'); fireEvent.click(screen.getByRole('button', { name: 'Clear retained row search' })); expect(first()).toBe('45'); expect(JSON.stringify(data)).toBe(before);
});
it('keeps duplicate ID ties stable and invalid missing and textual IDs last without coercion', () => {
 const data = [{ id: 3, host: 'three-first' }, { id: null, host: 'missing' }, { id: '1', host: 'text' }, { id: 3, host: 'three-second' }, { id: 0, host: 'zero' }, { id: 2, host: 'two' }]; render(<HuntQueryEvidence index={0} result={{ rows: data }} />); fireEvent.change(screen.getByLabelText('Retained row inspection order for query 1'), { target: { value: 'id-asc' } }); const hosts = () => screen.getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[1].textContent); expect(hosts()).toEqual(['two','three-first','three-second','missing','text','zero']); fireEvent.change(screen.getByLabelText('Retained row inspection order for query 1'), { target: { value: 'id-desc' } }); expect(hosts()).toEqual(['three-first','three-second','two','missing','text','zero']); fireEvent.change(screen.getByLabelText('Retained row inspection order for query 1'), { target: { value: 'retained' } }); expect(hosts()).toEqual(data.map(row => row.host));
});
it('exports original retained JSON order after reordering the inspection table', async () => {
 const blobs: Blob[] = []; vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:order'; }), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); const data = [{ id: 3 },{ id: 1 }]; render(<HuntQueryEvidence index={0} result={{ rows: data }} />); fireEvent.change(screen.getByLabelText('Retained row inspection order for query 1'), { target: { value: 'id-asc' } }); fireEvent.click(screen.getByRole('button', { name: 'Export retained query JSON' })); const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]); }); expect(JSON.parse(text).result.rows).toEqual(data);
});
