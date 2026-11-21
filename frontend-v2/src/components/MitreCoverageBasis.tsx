import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface BasisRow { technique_id: string; name: string; tactics: string[]; case_count: number; enabled_rule_count: number; disabled_rule_count: number; unknown_rule_state_count: number; basis: string; }
interface Result { catalog_scope: string; retrieved_at: string; total_techniques: number; tactics: { id: string; name: string }[]; counts: Record<string, number>; records: BasisRow[]; }
const labels = { both: 'Cases and enabled rules', case_only: 'Case associations only', rule_only: 'Enabled rules only', unmapped: 'No case or enabled-rule mapping' };
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function MitreCoverageBasis({ onSelectTechnique }: { onSelectTechnique?: (technique: string) => void } = {}) {
  const [open, setOpen] = useState(false), [retry, setRetry] = useState(0), [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [basis, setBasis] = useState(''), [tactic, setTactic] = useState(''), [disabledOnly, setDisabledOnly] = useState(false), [page, setPage] = useState(1);
  const reads = useRef(0);
  useEffect(() => {
    const id = ++reads.current; setResult(null); setError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Result>('/mitre/coverage-basis').then(({ data }) => {
      if (id !== reads.current) return;
      if (!data || !count(data.total_techniques) || typeof data.catalog_scope !== 'string' || typeof data.retrieved_at !== 'string' || !Number.isFinite(Date.parse(data.retrieved_at)) || !Array.isArray(data.tactics) || data.tactics.some(t => typeof t?.id !== 'string' || typeof t?.name !== 'string')
        || !Array.isArray(data.records) || data.records.length !== data.total_techniques || new Set(data.records.map(row => row?.technique_id)).size !== data.records.length
        || data.records.some(row => !row || !/^T[0-9]{4}(\.[0-9]{3})?$/.test(row.technique_id) || typeof row.name !== 'string' || !Array.isArray(row.tactics) || row.tactics.some(t => !data.tactics.some(value => value.id === t)) || ![row.case_count, row.enabled_rule_count, row.disabled_rule_count, row.unknown_rule_state_count].every(count)
          || row.basis !== (row.case_count ? row.enabled_rule_count ? 'both' : 'case_only' : row.enabled_rule_count ? 'rule_only' : 'unmapped'))
        || !data.counts || Object.keys(labels).some(key => !count(data.counts[key]) || data.counts[key] !== data.records.filter(row => row.basis === key).length)) throw new Error('Coverage basis did not match the recorded catalog evidence. Retry before relying on it.');
      setResult(data); setPage(1);
    }).catch(err => { if (id === reads.current) setError(getApiErrorMessage(err, 'Coverage basis is unavailable.')); }).finally(() => { if (id === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [open, retry]);
  const needle = query.trim().toLowerCase();
  const matches = result?.records.filter(row => (!basis || row.basis === basis) && (!tactic || row.tactics.includes(tactic)) && (!disabledOnly || row.disabled_rule_count > 0)
    && (!needle || [row.technique_id, row.name].some(value => value.toLowerCase().includes(needle)))) ?? [];
  return <section aria-label="ATT&CK coverage basis" className="oa-panel space-y-3 p-4">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="text-sm font-semibold text-primary-300">Explain coverage: case associations versus configured rules</button>
    {open && <>
      <p className="text-xs text-surface-400">A case technique association or enabled rule counts as a mapping in this product. Neither establishes tested detection, sensor deployment, rule quality or live protection. Cases include all saved statuses; rules use their current enabled flag. Disabled and unknown-state rules are shown but do not count as enabled mappings. Duplicate technique mentions count once per record. Sub-techniques stay separate from parent IDs.</p>
      {loading && <p role="status" className="text-sm text-surface-400">Loading current coverage basis...</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-danger"><p>{error} Missing evidence is unknown, not a confirmed gap.</p><button type="button" onClick={() => setRetry(value => value + 1)} className={control}>Retry coverage basis</button></div>}
      {!loading && !error && result && <>
        <p className="break-words text-xs text-surface-400">{result.catalog_scope} Read at {result.retrieved_at}. This is a new current read, not a frozen copy of the coverage summary.</p>
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-surface-400">{label}</dt><dd className="mt-1 text-lg font-semibold text-surface-100">{result.counts[key]}</dd></div>)}</dl>
        <div className="flex flex-wrap items-end gap-3"><label className="flex min-w-0 basis-full flex-1 flex-col gap-1 text-xs text-surface-400 sm:basis-64">Find technique<input aria-label="Find coverage basis technique" type="search" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} className={control} /></label>
          <select aria-label="Coverage mapping basis" value={basis} onChange={event => { setBasis(event.target.value); setPage(1); }} className={control}><option value="">All mapping bases</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label="Coverage basis tactic" value={tactic} onChange={event => { setTactic(event.target.value); setPage(1); }} className={control}><option value="">All catalog tactics</option>{result.tactics.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={disabledOnly} onChange={event => { setDisabledOnly(event.target.checked); setPage(1); }} />Has disabled rule references</label>
          <button type="button" onClick={() => { setQuery(''); setBasis(''); setTactic(''); setDisabledOnly(false); setPage(1); }} className={control}>Clear coverage basis filters</button>
        </div>
        <p role="status" className="text-xs text-surface-300">{matches.length} of {result.total_techniques} catalog techniques match. Counts above cover the full catalog; filters and pages change only this loaded view. Order: exact technique ID.</p>
        {matches.length ? <ul className="space-y-3">{matches.slice((page - 1) * 10, page * 10).map(row => <li key={row.technique_id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><h3 className="break-words text-sm font-semibold text-surface-100">{row.technique_id}: {row.name}</h3><p>{labels[row.basis as keyof typeof labels]}</p><p>{row.case_count} cases · {row.enabled_rule_count} enabled rules · {row.disabled_rule_count} disabled rules · {row.unknown_rule_state_count} rules with unknown state.</p><p className="break-words text-surface-400">Tactics: {row.tactics.map(id => result.tactics.find(t => t.id === id)?.name || id).join(', ') || 'not recorded'}. Use this exact technique ID in the full reference explorer below to inspect the saved associations.</p>{onSelectTechnique && <button type="button" onClick={() => onSelectTechnique(row.technique_id)} className={control}>Review saved associations for {row.technique_id}</button>}</li>)}</ul> : <p className="text-sm text-surface-400">No catalog techniques match these filters. This is not evidence of protection or absence of risk.</p>}
        <nav aria-label="Coverage basis pages" className="flex flex-wrap items-center gap-2"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className={control}>Previous basis page</button><span className="text-xs text-surface-400">Page {page} of {Math.max(1, Math.ceil(matches.length / 10))}</span><button type="button" disabled={page * 10 >= matches.length} onClick={() => setPage(value => value + 1)} className={control}>More basis techniques</button><button type="button" onClick={() => setRetry(value => value + 1)} className={control}>Refresh coverage basis</button></nav>
      </>}
    </>}
  </section>;
}
