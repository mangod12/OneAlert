import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelineExplorer, type TimelineRecord } from './TimelineExplorer';
afterEach(cleanup);
const entries: TimelineRecord[] = [
  { id: 1, timestamp: '2026-11-19T10:00:00Z', entry_type: 'note', source: 'human', content: 'Host isolated', author_email: 'analyst@example.test' },
  { id: 2, timestamp: '2026-11-19T09:00:00Z', entry_type: 'alert', source: 'agent', content: 'Remote login detected', author_email: null },
  { id: 3, timestamp: '2026-11-19T11:00:00Z', entry_type: 'note', source: 'human', content: 'Memory image collected', author_email: 'responder@example.test' },
];
function show(pinnedIds: number[] = []) {
  return render(<TimelineExplorer entries={entries} pinnedIds={pinnedIds}>{entry => <div key={entry.id} data-testid="entry">{entry.content}</div>}</TimelineExplorer>);
}
describe('timeline explorer', () => {
  it('searches loaded content and authors case-insensitively and clears filters', () => {
    show();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find timeline evidence' }), { target: { value: ' ANALYST@ ' } });
    expect(screen.getByText('Host isolated')).toBeInTheDocument();
    expect(screen.queryByText('Memory image collected')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Clear timeline filters' }));
    expect(screen.getAllByTestId('entry')).toHaveLength(3);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'remote login' } });
    expect(screen.getByText('Remote login detected')).toBeInTheDocument();
  });
  it('combines source/type filters and reports no matches without false emptiness', () => {
    show();
    fireEvent.change(screen.getByRole('combobox', { name: 'Timeline entry type' }), { target: { value: 'note' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Timeline source' }), { target: { value: 'agent' } });
    expect(screen.getByText(/No timeline entries match/)).toBeInTheDocument();
    expect(screen.queryByText('No timeline entries yet.')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('entry')).toHaveLength(0);
  });
  it('sorts timestamps while preserving recorded order as the default', () => {
    show();
    const order = () => screen.getAllByTestId('entry').map(node => node.textContent);
    expect(order()).toEqual(entries.map(e => e.content));
    fireEvent.change(screen.getByRole('combobox', { name: 'Timeline order' }), { target: { value: 'newest' } });
    expect(order()).toEqual(['Memory image collected', 'Host isolated', 'Remote login detected']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Timeline order' }), { target: { value: 'oldest' } });
    expect(order()).toEqual(['Remote login detected', 'Host isolated', 'Memory image collected']);
  });
  it('keeps linked and edited entries visible outside filters, with an explicit count', () => {
    show([1]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'memory' } });
    expect(screen.getByText('Host isolated')).toBeInTheDocument();
    expect(screen.getByText('Memory image collected')).toBeInTheDocument();
    expect(screen.getByText(/1 linked or edited entry is kept visible/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 loaded entries match');
    expect(screen.getAllByTestId('entry')).toHaveLength(2);
  });
  it('does not duplicate matching pinned entries', () => {
    show([1]);
    expect(screen.getAllByTestId('entry')).toHaveLength(3);
    expect(screen.queryByText(/kept visible outside/)).not.toBeInTheDocument();
  });
  it('handles an empty timeline', () => {
    render(<TimelineExplorer<TimelineRecord> entries={[]}>{entry => <span key={entry.id}>{entry.content}</span>}</TimelineExplorer>);
    expect(screen.getByText('No timeline entries yet.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
