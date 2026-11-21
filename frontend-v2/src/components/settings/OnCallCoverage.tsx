import { useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
interface Coverage { timezone: string; from_date: string; until_exclusive: string; retrieved_at: string; configured: boolean; anchor_date: string | null; active_member_count: number; coverage: { from_date: string; until_exclusive: string; member_id: number | null; member_name: string | null; on_call_override_available: boolean }[] }
const validDay = (value: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function OnCallCoverage({ revision }: { revision: string }) {
  const [data, setData] = useState<Coverage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const reads = useRef(0);
  useEffect(() => {
    const request = ++reads.current; setLoading(true); setData(null); setError('');
    void apiClient.get<Coverage>('/orgs/me/on-call/coverage').then(({ data: result }) => {
      if (reads.current !== request) return;
      if (!result || result.timezone !== 'UTC' || typeof result.configured !== 'boolean' || !Array.isArray(result.coverage) || result.coverage.length > 9 || !Number.isSafeInteger(result.active_member_count) || result.active_member_count < 0 || !validDay(result.from_date) || !validDay(result.until_exclusive) || Date.parse(result.until_exclusive) - Date.parse(result.from_date) !== 56 * 86400000 || !Number.isFinite(Date.parse(result.retrieved_at)) || (!result.configured && result.coverage.length)) throw new Error('Saved rotation coverage could not be verified. Refresh the preview.');
      let previous = result.from_date;
      for (const slot of result.coverage) {
        if (typeof slot.on_call_override_available !== 'boolean' || !validDay(slot.from_date) || !validDay(slot.until_exclusive) || slot.from_date !== previous || slot.until_exclusive <= slot.from_date || slot.until_exclusive > result.until_exclusive || (slot.on_call_override_available ? !Number.isSafeInteger(slot.member_id) || slot.member_id! <= 0 || typeof slot.member_name !== 'string' : slot.member_id !== null || slot.member_name !== null)) throw new Error('Coverage periods did not match the requested saved rotation preview. Refresh the preview.');
        previous = slot.until_exclusive;
      }
      if (result.configured && (!result.coverage.length || previous !== result.until_exclusive)) throw new Error('Saved rotation preview is incomplete. Refresh the preview.');
      setData(result);
    }).catch(err => { if (reads.current === request) setError(getApiErrorMessage(err, 'Saved rotation coverage could not be loaded.')); }).finally(() => { if (reads.current === request) setLoading(false); });
    return () => { reads.current += 1; };
  }, [revision, retry]);
  return <section aria-label="Saved on-call coverage preview" className="space-y-3 border-t border-surface-700 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-surface-100">Next 8 weeks of saved on-call coverage</h3><button type="button" disabled={loading} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40" onClick={() => setRetry(value => value + 1)}>Refresh coverage preview</button></div>
    <p className="text-xs text-surface-400">Read-only forecast from the saved rotation and current active roster, in UTC. Dates run from the start date through, but not including, the end date. The first and last periods can be partial weeks. Roster and rotation changes can change future coverage. This preview does not save settings, enable auto-assignment or reassign work.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading saved coverage...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!loading && !error && data && <>
      <p className="break-words text-xs text-surface-400">{data.from_date} to {data.until_exclusive} (exclusive) · UTC · Read {data.retrieved_at}</p>
      {!data.configured ? <p className="text-sm text-surface-300">No saved rotation. There is no scheduled on-call override.</p> : <>
        {data.active_member_count < 2 && <p className="text-xs text-warning">Fewer than two active members. Automatic new-work assignment requires at least two, even if a rotation member is available.</p>}
        <ol className="grid gap-3 sm:grid-cols-2">{data.coverage.map(slot => <li key={slot.from_date} className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><p className="break-words text-xs text-surface-400">{slot.from_date} to {slot.until_exclusive} (exclusive)</p>{slot.on_call_override_available ? <p className="break-words text-sm text-surface-100 [overflow-wrap:anywhere]">{slot.member_name} · Member #{slot.member_id}</p> : <p className="text-sm text-warning">Scheduled member unavailable. No on-call override for this period; existing load-balancing rules apply.</p>}</li>)}</ol>
        <p className="text-xs text-surface-400">Saved anchor: {data.anchor_date}. Availability means active in this organization now, not confirmed future attendance or working hours. Before a future anchor, the existing assignment rule keeps the first rotation member.</p>
      </>}
    </>}
  </section>;
}
