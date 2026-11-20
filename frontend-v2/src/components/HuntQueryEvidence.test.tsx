import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HuntQueryEvidence } from './HuntQueryEvidence';
afterEach(cleanup);
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
