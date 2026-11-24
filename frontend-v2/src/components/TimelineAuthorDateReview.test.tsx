import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TimelineExplorer } from './TimelineExplorer';
afterEach(cleanup);
const entries = [
 { id: 1, timestamp: '2026-11-24T00:30:00+05:30', entry_type: 'note', source: 'human', content: 'UTC previous day', author_email: 'analyst@example.test' },
 { id: 2, timestamp: '2026-11-24T23:59:59Z', entry_type: 'note', source: 'human', content: 'UTC boundary', author_email: 'analyst@example.test' },
 { id: 3, timestamp: 'not recorded', entry_type: 'action', source: 'agent', content: 'No timestamp', author_email: null },
 { id: 4, timestamp: '2026-11-24T12:00:00Z', entry_type: 'note', source: 'human', content: 'Other author', author_email: 'other@example.test' },
];
function show(pinnedIds: number[] = []) { return render(<TimelineExplorer entries={entries} pinnedIds={pinnedIds}>{entry => <div key={entry.id} data-testid="entry">{entry.content}</div>}</TimelineExplorer>); }
it('combines exact author with inclusive UTC boundaries and existing search/type/source, clearing all scopes', () => {
 show();fireEvent.change(screen.getByLabelText('Timeline recorded author'), { target: { value: 'analyst@example.test' } });fireEvent.change(screen.getByLabelText('Timeline from UTC date'), { target: { value: '2026-11-24' } });fireEvent.change(screen.getByLabelText('Timeline through UTC date'), { target: { value: '2026-11-24' } });fireEvent.change(screen.getByLabelText('Timeline entry type'), { target: { value: 'note' } });fireEvent.change(screen.getByLabelText('Timeline source'), { target: { value: 'human' } });
 expect(screen.getAllByTestId('entry').map(n => n.textContent)).toEqual(['UTC boundary']);expect(screen.getByRole('status').textContent).toContain('1 of 4');fireEvent.click(screen.getByRole('button', { name: 'Clear timeline filters' }));expect(screen.getAllByTestId('entry')).toHaveLength(4);expect(screen.getByLabelText('Timeline from UTC date')).toHaveProperty('value', '');
});
it('keeps pinned evidence separately visible under invalid reversed dates, never counted as a match', () => {
 show([1]);fireEvent.change(screen.getByLabelText('Timeline from UTC date'), { target: { value: '2026-11-25' } });fireEvent.change(screen.getByLabelText('Timeline through UTC date'), { target: { value: '2026-11-24' } });expect(screen.getByRole('alert').textContent).toContain('From on or before Through');expect(screen.getByRole('status').textContent).toContain('0 of 4');expect(screen.getByText(/1 linked or edited entry is kept/)).toBeTruthy();expect(screen.getAllByTestId('entry').map(n => n.textContent)).toEqual(['UTC previous day']);
});
it('treats unrecorded authors explicitly and retains a disappeared selection without broadening refreshed rows', () => {
 const view=show();fireEvent.change(screen.getByLabelText('Timeline recorded author'), { target: { value: 'unrecorded' } });expect(screen.getAllByTestId('entry').map(n => n.textContent)).toEqual(['No timestamp']);fireEvent.change(screen.getByLabelText('Timeline recorded author'), { target: { value: 'analyst@example.test' } });view.rerender(<TimelineExplorer entries={entries.slice(2)}>{entry => <div key={entry.id} data-testid="entry">{entry.content}</div>}</TimelineExplorer>);expect(screen.queryAllByTestId('entry')).toHaveLength(0);expect(screen.getByText(/selected author is no longer present/)).toBeTruthy();
});
