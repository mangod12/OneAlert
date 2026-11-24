import { expect, it } from 'vitest';
import { checkedWatchlistView } from './watchlistViews';
const filters = { query: 'gateway + π & 100%_', kind: 'case', severity: 'high', scope: 'overdue', sort: 'due' };
it('restores exact search criteria and trims only outer search whitespace', () => { expect(checkedWatchlistView(filters)).toEqual(filters); expect(checkedWatchlistView({ ...filters, query: '  gateway  ' })?.query).toBe('gateway'); });
it.each([null, [], {}, { ...filters, page: 2 }, { ...filters, records: [] }, { ...filters, watcher_ids: [7] }, { ...filters, today: '2026-11-24' }, { ...filters, query: 'x'.repeat(201) }, { ...filters, kind: 'hidden' }, { ...filters, severity: 'urgent' }, { ...filters, scope: 'mine' }, { ...filters, sort: 'random' }, { ...filters, kind: 1 }])('rejects invalid or record/subscription-bearing values %j', value => { expect(checkedWatchlistView(value)).toBeNull(); });
it.each(['today', 'future', 'undated'])('preserves %s as private saved criteria, never a fixed date or result snapshot', scope => { expect(checkedWatchlistView({ ...filters, scope })).toEqual({ ...filters, scope }); });
