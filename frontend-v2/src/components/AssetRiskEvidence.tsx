import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';

type RecordRow = { id: number; title: string; severity: string; status: string; base_points: number; cve_id: string | null; created_at: string | null };
interface Evidence {
  asset_id: number; asset_name: string; criticality: string | null; multiplier: number;
  base_points: number; rounded_points: number; score: number; level: string;
  included_statuses: string[]; status_counts: Record<string, number>; total: number;
  severity_breakdown: { severity: string; count: number; weight: number; base_points: number }[];
  page: number; size: number; retrieved_at: string; records: RecordRow[];
}
const included = ['pending', 'sent', 'acknowledged'];
const weights: Record<string, number> = { critical: 10, high: 5, medium: 2, low: 1 };
const multipliers: Record<string, number> = { critical: 2, high: 1.5, medium: 1, low: 0.5 };
const whole = (value: number) => Number.isSafeInteger(value) && value >= 0;
const weight = (severity: string) => weights[severity.toLowerCase()] ?? 1;
const level = (score: number) => score >= 40 ? 'critical' : score >= 15 ? 'high' : score >= 5 ? 'medium' : score > 0 ? 'low' : 'none';
function roundEven(value: number) { const floor = Math.floor(value); return value - floor === 0.5 ? floor + floor % 2 : Math.round(value); }
function valid(data: Evidence, assetId: number, page: number) {
  if (!data || data.asset_id !== assetId || data.page !== page || data.size !== 10 || !whole(data.total) || !whole(data.base_points) || !Array.isArray(data.records) || data.records.length > 10 || !Array.isArray(data.severity_breakdown) || !data.status_counts || !Array.isArray(data.included_statuses)) return false;
  if (included.some(value => !data.included_statuses.includes(value)) || data.included_statuses.length !== included.length || Object.values(data.status_counts).some(value => !whole(value)) || included.reduce((sum, status) => sum + (data.status_counts[status] ?? 0), 0) !== data.total) return false;
  if (data.multiplier !== (multipliers[(data.criticality ?? 'medium').toLowerCase()] ?? 1) || data.rounded_points !== roundEven(data.base_points * data.multiplier) || data.score !== Math.min(100, data.rounded_points) || data.level !== level(data.score)) return false;
  if (data.severity_breakdown.some(row => typeof row.severity !== 'string' || !whole(row.count) || row.weight !== weight(row.severity) || row.base_points !== row.count * row.weight) || new Set(data.severity_breakdown.map(row => row.severity)).size !== data.severity_breakdown.length) return false;
  if (data.severity_breakdown.reduce((sum, row) => sum + row.count, 0) !== data.total || data.severity_breakdown.reduce((sum, row) => sum + row.base_points, 0) !== data.base_points) return false;
  return data.records.every(row => Number.isSafeInteger(row.id) && row.id > 0 && typeof row.title === 'string' && typeof row.severity === 'string' && included.includes(row.status) && row.base_points === weight(row.severity)) && new Set(data.records.map(row => row.id)).size === data.records.length;
}
export function AssetRiskEvidence({ assetId, onNavigate }: { assetId: number; onNavigate?: () => void }) {
  const [opened, setOpened] = useState(false), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<Evidence | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setData(null); setError('');
    if (!opened) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Evidence>(`/assets/${assetId}/risk-evidence`, { params: { page, size: 10 } }).then(({ data: result }) => {
      if (request !== reads.current) return;
      if (!valid(result, assetId, page)) throw new Error('Risk evidence did not match this asset, page or calculation. Refresh the evidence.');
      const last = Math.max(1, Math.ceil(result.total / 10)); if (page > last) { setPage(last); return; }
      setData(result);
    }).catch(err => { if (request === reads.current) setError(getApiErrorMessage(err, 'Risk evidence could not be loaded.')); })
      .finally(() => { if (request === reads.current) setLoading(false); });
    return () => { reads.current += 1; };
  }, [assetId, page, retry, opened]);
  const excluded = data ? Object.entries(data.status_counts).filter(([status]) => !included.includes(status)).reduce((sum, [, count]) => sum + count, 0) : 0;
  return <section aria-label="Asset risk calculation evidence" className="space-y-3 rounded border border-surface-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Why this asset has its risk score</h3>
    <p className="text-xs text-surface-400">Current inventory calculation, not a vulnerability scan or probability of compromise. Pending, sent and acknowledged alerts contribute. Resolved, failed and other statuses do not. Counts and contributor pages are separate current reads, not a frozen snapshot. This can differ from the earlier score above if records changed.</p>
    {!opened ? <button type="button" onClick={() => setOpened(true)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Explain current asset risk</button> : <>
      {loading && <p role="status" className="text-xs text-surface-300">Loading risk evidence...</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {!loading && !error && data && data.page === page && data.asset_id === assetId && <>
        <p className="break-words text-sm text-surface-100">Current evidence score: {data.level} ({data.score})</p>
        <p className="text-xs text-surface-300">{data.base_points} base points × {data.multiplier} criticality multiplier ({data.criticality || 'medium default'}) = {data.rounded_points} rounded points, capped at 100. Half-point ties round to the nearest even integer.</p>
        <p className="text-xs text-surface-400">Full matching set: {data.total} contributing alerts; {excluded} owned alert records excluded by status. Severity weights: critical 10, high 5, medium 2, low 1, all other severities 1.</p>
        <dl className="grid gap-2 text-xs text-surface-300 sm:grid-cols-2">{data.severity_breakdown.map(row => <div key={row.severity}><dt className="break-words">{row.severity}</dt><dd>{row.count} alerts × {row.weight} = {row.base_points} base points</dd></div>)}</dl>
        {data.total === 0 && <p className="text-xs text-surface-300">No current contributing alerts. A zero score does not prove this asset is safe.</p>}
        <p className="break-words text-xs text-surface-400">Contributor page {page} of {Math.max(1, Math.ceil(data.total / 10))}, up to 10 records shown. Highest severity weight first, then newest alert ID. Received {data.retrieved_at}.</p>
        <ol className="space-y-2">{data.records.map(row => <li key={row.id} className="space-y-1 rounded border border-surface-700 p-3 text-xs text-surface-300">
          <Link onClick={onNavigate} to={`/alerts?alert=${row.id}`} className="break-words text-primary-300">Open contributing alert #{row.id}: {row.title}</Link>
          <p className="break-words">{row.severity} · {row.status} · {row.base_points} base points{row.cve_id ? ` · ${row.cve_id}` : ''}</p>
        </li>)}</ol>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Previous risk contributors</button><button type="button" disabled={page * 10 >= data.total} onClick={() => setPage(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">More risk contributors</button></div>
      </>}
      <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Refresh risk evidence</button>
    </>}
  </section>;
}
