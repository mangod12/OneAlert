import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Briefcase, Search, Server, Siren } from 'lucide-react';
import clsx from 'clsx';
import apiClient from '../api/client';
import { StatusBadge } from './ui/StatusBadge';
import { getApiErrorMessage } from '../api/errors';

interface AlertHit { id: number; title: string; severity: string; status: string }
interface CaseHit { id: number; title: string; status: string; severity: string }
interface AssetHit { id: number; name: string; vendor: string | null; asset_type: string }
interface IncidentHit { asset_id: number; asset_name: string; alert_count: number; max_severity: string }

interface SearchResults {
  alerts: AlertHit[];
  cases: CaseHit[];
  assets: AssetHit[];
  incidents?: IncidentHit[];
}

type FlatHit =
  | { key: string; group: 'incidents'; label: string; sub: string; to: string }
  | { key: string; group: 'alerts'; label: string; sub: string; to: string }
  | { key: string; group: 'cases'; label: string; sub: string; to: string }
  | { key: string; group: 'assets'; label: string; sub: string; to: string };

const severityTone = (severity: string): 'danger' | 'warning' | 'info' | 'neutral' => {
  if (severity === 'critical' || severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  if (severity === 'low') return 'info';
  return 'neutral';
};

function flatten(results: SearchResults | null): FlatHit[] {
  if (!results) return [];
  return [
    ...(results.incidents ?? []).map(i => ({
      key: `incident-${i.asset_id}`, group: 'incidents' as const, label: i.asset_name,
      sub: `Incident · ${i.max_severity} · ${i.alert_count} active alerts · Asset #${i.asset_id}`, to: `/incidents?asset_id=${i.asset_id}`,
    })),
    ...results.alerts.map(a => ({
      key: `alert-${a.id}`, group: 'alerts' as const, label: a.title,
      sub: `Alert · ${a.severity} · ${a.status}`, to: `/alerts?alert=${a.id}`,
    })),
    ...results.cases.map(c => ({
      key: `case-${c.id}`, group: 'cases' as const, label: c.title,
      sub: `Case · ${c.severity} · ${c.status}`, to: `/cases/${c.id}`,
    })),
    ...results.assets.map(a => ({
      key: `asset-${a.id}`, group: 'assets' as const, label: a.name,
      sub: `Asset · ${a.asset_type}${a.vendor ? ` · ${a.vendor}` : ''} · #${a.id}`,
      to: `/assets?asset=${a.id}`,
    })),
  ];
}

const groupMeta = {
  incidents: { heading: 'Incidents', icon: Siren },
  alerts: { heading: 'Alerts', icon: AlertTriangle },
  cases: { heading: 'Investigations', icon: Briefcase },
  assets: { heading: 'Assets', icon: Server },
} as const;

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const [resultQuery, setResultQuery] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const hits = useMemo(() => flatten(resultQuery === query.trim() && !error ? results : null), [results, resultQuery, query, error]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults(null);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const trimmed = query.trim();
    setResults(null); setResultQuery(''); setError(''); setActiveIndex(0);
    if (trimmed.length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await apiClient.get('/search', { params: { q: trimmed } });
          if (cancelled) return;
          setResults(res.data.data as SearchResults); setResultQuery(trimmed); setActiveIndex(0);
        } catch (err) {
          if (!cancelled) setError(getApiErrorMessage(err, 'Workspace search is unavailable. No absence of matching records is inferred.'));
        } finally { if (!cancelled) setSearching(false); }
      })();
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, retry]);

  const go = useCallback((hit: FlatHit) => {
    onClose();
    navigate(hit.to);
  }, [navigate, onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(i => (hits.length ? (i + 1) % hits.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(i => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) go(hit);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  let flatIndex = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-surface-950/70" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Global search"
        className="relative w-full max-w-xl overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-xl">
        <div className="flex items-center gap-2 border-b border-surface-700 px-4">
          <Search className="h-4 w-4 shrink-0 text-surface-500" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            maxLength={200}
            role="combobox"
            aria-expanded="true"
            aria-controls="global-search-results"
            aria-activedescendant={hits[activeIndex] ? `global-search-hit-${hits[activeIndex].key}` : undefined}
            aria-label="Search incidents, alerts, investigations and assets"
            placeholder="Search alerts, investigations, assets..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent py-3 text-sm text-surface-100 placeholder-surface-500 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-surface-700 px-1.5 py-0.5 text-[10px] text-surface-500">Esc</kbd>
        </div>
        <div id="global-search-results" role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-xs text-surface-500">Type at least 2 characters to search across your workspace.</p>
          ) : error ? (
            <div className="space-y-2 px-3 py-4"><p role="alert" className="text-xs text-danger">{error}</p><button type="button" className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300" onClick={() => setRetry(value => value + 1)}>Retry workspace search</button></div>
          ) : searching || resultQuery !== query.trim() ? (
            <p className="px-3 py-6 text-center text-xs text-surface-500">Searching...</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-surface-500">No incidents, alerts, investigations or assets match "{query.trim()}".</p>
          ) : (
            (['incidents', 'alerts', 'cases', 'assets'] as const).map(group => {
              const groupHits = hits.filter(h => h.group === group);
              if (groupHits.length === 0) return null;
              const Meta = groupMeta[group];
              return (
                <div key={group} className="mb-1 last:mb-0">
                  <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-surface-500">
                    <Meta.icon className="h-3 w-3" aria-hidden="true" /> {Meta.heading}
                  </p>
                  {groupHits.map(hit => {
                    flatIndex += 1;
                    const isActive = flatIndex === activeIndex;
                    const thisIndex = flatIndex;
                    return (
                      <button
                        key={hit.key}
                        id={`global-search-hit-${hit.key}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(thisIndex)}
                        onClick={() => go(hit)}
                        className={clsx(
                          'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left',
                          isActive ? 'bg-primary-500/10' : 'hover:bg-surface-800',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block break-words text-sm text-surface-100 [overflow-wrap:anywhere]">{hit.label}</span>
                          <span className="block break-words text-xs text-surface-500 [overflow-wrap:anywhere]">{hit.sub}</span>
                        </span>
                        {hit.group !== 'assets' && (
                          <StatusBadge tone={severityTone(hit.sub.split(' · ')[1] ?? '')}>
                            {hit.sub.split(' · ')[1]}
                          </StatusBadge>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <p className="px-4 py-2 text-[10px] text-surface-400">Up to 5 matches per record type from records owned by your account. Not a complete workspace search. Incident matches use the matching assets' current active alerts.</p>
        <div className="flex items-center gap-3 border-t border-surface-700 px-4 py-2 text-[10px] text-surface-500">
          <span><kbd className="rounded border border-surface-700 px-1">↑↓</kbd> move</span>
          <span><kbd className="rounded border border-surface-700 px-1">Enter</kbd> open</span>
          <span><kbd className="rounded border border-surface-700 px-1">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
