import { expect, it } from 'vitest';
import { loadedWatchlistSearch } from './loadedWatchlistSearch';
const filters = { query: '  gateway + π %_ &  ', kind: 'all', severity: 'high', scope: 'open', order: 'name' };
it('encodes exact criteria, maps active semantics and never includes records or page', () => { const q = new URLSearchParams(loadedWatchlistSearch(filters)!); expect(Object.fromEntries(q)).toEqual({ explore: '1', query: 'gateway + π %_ &', severity: 'high', scope: 'active', sort: 'name' }); });
it.each(['all', 'case'])('keeps investigation-only overdue for %s', kind => { expect(new URLSearchParams(loadedWatchlistSearch({ ...filters, kind, scope: 'overdue' })!).get('kind')).toBe('case'); });
it('does not widen incompatible alert overdue or truncate long input', () => { expect(loadedWatchlistSearch({ ...filters, kind: 'alert', scope: 'overdue' })).toBeNull(); expect(loadedWatchlistSearch({ ...filters, query: 'x'.repeat(201) })).toBeNull(); });
it.each([{ kind: 'hidden' }, { severity: 'urgent' }, { scope: 'today' }, { order: 'random' }])('blocks unsupported criteria %j', value => { expect(loadedWatchlistSearch({ ...filters, ...value })).toBeNull(); });
it('keeps the default route explicit without changing any filters', () => { expect(loadedWatchlistSearch({ query: '', kind: 'all', severity: 'all', scope: 'all', order: 'severity' })).toBe('explore=1'); });
