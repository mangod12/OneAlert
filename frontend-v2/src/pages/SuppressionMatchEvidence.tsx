import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
interface Rule { id: number; name: string; enabled: boolean; cve_id: string | null; asset_id: number | null; severity: string | null; title_contains: string | null; duration_hours: number; created_at: string }
interface Match { id: number; asset_id: number | null; title: string; cve_id: string | null; severity: string; status: string; created_at: string }
interface Snapshot { rule: Rule; page: number; size: number; scope: string; search: string; total: number; matching_total: number; criteria_present: boolean; retrieved_at: string; alerts: Match[] }
const recorded = (value: unknown) => value === null || value === undefined || value === '' ? 'Not set' : String(value);
export function SuppressionMatchEvidence() {
  const { ruleId = '' } = useParams();
  const id = /^[1-9][0-9]*$/.test(ruleId) && Number.isSafeInteger(Number(ruleId)) ? Number(ruleId) : null;
  const [page, setPage] = useState(1), [scope, setScope] = useState('active'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    const read = ++request.current; setSnapshot(null); setError(''); if (id === null) { setLoading(false); return; } setLoading(true);
    void apiClient.get<Snapshot>(`/suppression-rules/${id}/matching-alerts`, { params: { page, size: 10, scope, search } }).then(({ data }) => {
      if (read !== request.current) return;
      if (data.rule?.id !== id || data.page !== page || data.size !== 10 || data.scope !== scope || data.search !== search || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.matching_total) || data.matching_total < data.total || typeof data.criteria_present !== 'boolean' || !Array.isArray(data.alerts) || data.alerts.some(row => !Number.isSafeInteger(row.id) || row.id <= 0)) throw new Error('The evidence did not match this rule and filter. Refresh before relying on it.');
      const last = Math.max(1, Math.ceil(data.total / 10)); if (page > last) { setPage(last); return; } setSnapshot(data);
    }).catch(err => { if (read === request.current) setError(getApiErrorMessage(err, 'Rule evidence could not be loaded.')); }).finally(() => { if (read === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [id, page, scope, search, retry]);
  return <div className="space-y-5 text-surface-300">
    <PageHeader eyebrow="Govern" title="Suppression rule evidence" description="Read-only saved criteria and existing alerts that match them now." />
    <a href="/app/settings" className="inline-block text-sm text-primary-300">Back to settings</a>
    {id === null ? <p role="alert">This rule link needs a positive whole-number record ID. No evidence was loaded.</p> : <>
      <p className="text-sm text-surface-400">This review does not create, pause, enable or apply a rule. Matches compare current alert values with saved criteria, even for a paused rule. They are not a history of alerts this rule actually snoozed, and do not show which rule will win for future alerts. Existing alert states are unchanged.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); setRetry(n => n + 1); }}><label className="min-w-0 text-xs">Title, CVE or alert ID<input aria-label="Search rule matches" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} className="mt-1 block w-full rounded border border-surface-600 bg-surface-950 p-2" /></label><button type="submit" className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Search matching alerts</button><label className="text-xs">Alert status scope<select aria-label="Rule match status scope" value={scope} onChange={event => { setScope(event.target.value); setPage(1); }} className="mt-1 block rounded border border-surface-600 bg-surface-950 p-2"><option value="active">Active: pending, sent, acknowledged</option><option value="all">All statuses, including snoozed and resolved</option></select></label></form>
      {query.trim() !== search && <p className="text-xs text-warning">Draft search not applied. Results use the last submitted search.</p>}
      {loading && <p role="status">Loading rule evidence...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="button" disabled={loading} onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Refresh rule evidence</button>
      {!loading && !error && snapshot && <>
        <section aria-label="Saved suppression criteria" className="oa-panel space-y-3 p-4 [overflow-wrap:anywhere]"><h2 className="font-semibold text-surface-100">Rule #{snapshot.rule.id}: {snapshot.rule.name}</h2><p className="text-sm">{snapshot.rule.enabled ? 'Enabled for new matching alerts' : 'Paused, criteria shown for inspection'} · Snooze window: {snapshot.rule.duration_hours}h</p>{!snapshot.criteria_present && <p role="alert" className="text-sm text-warning">This legacy record has no criteria. Its matcher can match every alert. This read-only review does not repair or enable it.</p>}<dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries({ 'CVE (case-insensitive exact match)': snapshot.rule.cve_id, 'Asset record ID (exact)': snapshot.rule.asset_id, 'Severity (case-insensitive exact match)': snapshot.rule.severity, 'Title contains (literal, case-insensitive)': snapshot.rule.title_contains, 'Rule created': snapshot.rule.created_at }).map(([field, value]) => <div key={field}><dt className="text-surface-400">{field}</dt><dd className="whitespace-pre-wrap">{recorded(value)}</dd></div>)}</dl><p className="text-xs text-surface-400">Every set criterion must match. Unset criteria impose no restriction. Read at {snapshot.retrieved_at}; rule and alert rows are separate current reads, not a frozen historical snapshot.</p></section>
        <p className="text-sm [overflow-wrap:anywhere]">{snapshot.total} matching alerts after search · {snapshot.matching_total} criteria matches in {scope === 'active' ? 'active statuses' : 'all statuses'} before search. Applied search: {search || 'None'}.</p>
        {!snapshot.alerts.length && <p className="text-sm text-surface-400">No current alert rows match this scope. Future alerts can differ.</p>}
        <ol className="space-y-3">{snapshot.alerts.map(alert => <li key={alert.id} className="oa-panel space-y-2 p-4 text-sm [overflow-wrap:anywhere]"><h3 className="font-semibold text-surface-100">Alert #{alert.id}: {alert.title}</h3><p>{alert.severity} · {alert.status} · {alert.cve_id || 'No CVE recorded'} · Asset {recorded(alert.asset_id)}</p><p className="text-xs text-surface-400">Created {alert.created_at}</p><a className="inline-block text-xs text-primary-300" href={`/app/alerts?alert=${alert.id}`}>Open exact alert #{alert.id}</a></li>)}</ol>
        <div className="flex flex-wrap items-center gap-3 text-xs"><span>Page {page} of {Math.max(1, Math.ceil(snapshot.total / 10))}</span><button type="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Previous rule matches</button><button type="button" disabled={page * 10 >= snapshot.total} onClick={() => setPage(n => n + 1)} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">More rule matches</button></div>
      </>}
    </>}
  </div>;
}
