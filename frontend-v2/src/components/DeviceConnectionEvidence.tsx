import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { DeviceRecordLink } from './DeviceRecordLink';
import { getApiErrorMessage } from '../api/errors';
import type { RecordedTopologyEdge } from './TopologyConnectionEvidence';
interface Connection extends Omit<RecordedTopologyEdge, 'is_encrypted'> { id: number; is_encrypted: boolean | null; record_reference_match: boolean; ip_address_match: boolean; }
interface Summary { total: number; record_references: number; ip_matches: number; both_matches: number; encrypted: number; cleartext: number; unknown_encryption: number; }
interface Snapshot { summary?: Summary | null; device_id: number; ip_address: string; page: number; size: number; total: number; match: string; encryption: string; retrieved_at: string; connections: Connection[]; }
const control = 'rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function DeviceConnectionEvidence({ deviceId }: { deviceId: number }) {
  const [opened, setOpened] = useState(false);
  const [match, setMatch] = useState('all');
  const [encryption, setEncryption] = useState('all');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current;
    setSnapshot(null); setError(''); setDownloadError('');
    if (!opened) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get<Snapshot>(`/ot/discovered-devices/${deviceId}/connections`, { params: { page, size: 20, match, encryption } }).then(response => {
      if (request !== requestId.current) return;
      const value = response.data;
      if (value.device_id !== deviceId || value.match !== match || value.encryption !== encryption || value.page !== page || value.size !== 20) throw new Error('Connection evidence did not match the requested device and filters. Try again.');
      const lastPage = Math.max(1, Math.ceil(value.total / 20));
      if (page > lastPage) { setPage(lastPage); return; }
      const s = value.summary;
      const summaryValid = s && [s.total, s.record_references, s.ip_matches, s.both_matches, s.encrypted, s.cleartext, s.unknown_encryption].every(n => Number.isSafeInteger(n) && n >= 0)
        && s.total === value.total && s.record_references + s.ip_matches - s.both_matches === s.total
        && s.both_matches <= Math.min(s.record_references, s.ip_matches) && s.record_references <= s.total && s.ip_matches <= s.total
        && s.encrypted + s.cleartext + s.unknown_encryption === s.total
        && (match !== 'record' || s.record_references === s.total) && (match !== 'ip' || s.ip_matches === s.total)
        && (encryption === 'all' || (encryption === 'unknown' ? s.unknown_encryption : encryption === 'encrypted' ? s.encrypted : s.cleartext) === s.total);
      setSnapshot({ ...value, summary: summaryValid ? s : null });
    }).catch(err => { if (request === requestId.current) setError(getApiErrorMessage(err, 'Device connection evidence could not be loaded.')); })
      .finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [deviceId, opened, match, encryption, page, retry]);
  const download = () => {
    if (!snapshot || loading || error) return;
    setDownloadError('');
    try {
      const body = { schema_version: 1, evidence_type: 'recorded_device_connection_page', exported_at: new Date().toISOString(), scope: 'Only this loaded, filtered page of owner-visible connection records, plus the full matching aggregate summary when available. Other connection rows are not included. A device-record reference and an IP address match are separate recorded facts. Neither proves physical identity or live traffic. Encryption and direction are stored labels, not verified flow properties.', ...snapshot };
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `device-${deviceId}-connection-evidence-page-${snapshot.page}.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError('Connection evidence could not be downloaded. The loaded records remain available.'); }
  };
  return <section className="space-y-3 rounded-lg border border-surface-700 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-surface-100">Recorded connection matches</h3><button type="button" aria-expanded={opened} onClick={() => setOpened(!opened)} className={control}>{opened ? 'Hide connection matches' : 'Review connection matches'}</button></div>
    <p className="text-xs text-surface-400">Connections may reference this device record, exactly match its recorded IP address text, or both. Shared or changed IPs do not prove physical identity. These records are not a live scan or traffic capture. Direction and encryption are stored labels, not verified flow properties.</p>
    {opened && <>
      <div className="flex flex-wrap gap-2"><label className="min-w-0 text-xs text-surface-300">Match basis<select aria-label="Connection match basis" value={match} onChange={event => { setMatch(event.target.value); setPage(1); }} className={`${control} mt-1 block w-full`}><option value="all">Record reference or IP match</option><option value="record">Device record reference</option><option value="ip">Exact recorded IP match</option></select></label><label className="min-w-0 text-xs text-surface-300">Recorded encryption<select aria-label="Connection encryption filter" value={encryption} onChange={event => { setEncryption(event.target.value); setPage(1); }} className={`${control} mt-1 block w-full`}><option value="all">All recorded flags</option><option value="cleartext">Recorded cleartext</option><option value="encrypted">Recorded encrypted</option><option value="unknown">Encryption flag not recorded</option></select></label><button type="button" onClick={() => setRetry(retry + 1)} disabled={loading} className={`${control} self-end`}>Refresh connection matches</button></div>
      {loading && <p role="status" className="text-xs text-surface-300">Loading recorded connection matches...</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-xs text-danger">{error}</p><button type="button" onClick={() => setRetry(retry + 1)} className={control}>Retry connection matches</button></div>}
      {!loading && !error && snapshot && <>
        <p className="break-words text-xs text-surface-400">Device #{snapshot.device_id}, current IP {snapshot.ip_address}. {snapshot.total} matching records. Page {snapshot.page} of {Math.max(1, Math.ceil(snapshot.total / snapshot.size))}. Received {snapshot.retrieved_at}.</p>
        <section role="region" aria-label="Full matching connection summary" className="space-y-2 rounded border border-surface-700 p-3">
          <h4 className="font-semibold text-surface-100">Full matching recorded connections</h4>
          <p className="text-xs text-surface-400">Counts cover all matching records before paging. Reference and IP counts overlap; both-match records are counted once in the total. Stored encryption flags do not verify live encryption. Missing flags are not cleartext.</p>
          {snapshot.summary ? <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">{[
            ['Matching records', snapshot.summary.total], ['Device record references', snapshot.summary.record_references],
            ['Exact IP matches', snapshot.summary.ip_matches], ['Both reference and IP', snapshot.summary.both_matches],
            ['Recorded encrypted', snapshot.summary.encrypted], ['Recorded cleartext', snapshot.summary.cleartext],
            ['Encryption flag not recorded', snapshot.summary.unknown_encryption],
          ].map(([label, count]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="mt-1 font-semibold text-surface-100">{count}</dd></div>)}</dl> : <p role="status" className="text-xs text-warning">Full matching connection summary unavailable. Counts are not inferred from this loaded page.</p>}
        </section>
        <button type="button" onClick={download} disabled={snapshot.connections.length === 0} className={control}>Download loaded connection page JSON</button>
        {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
        {snapshot.connections.length === 0 ? <p className="text-xs text-surface-300">No recorded connections match these filters. This does not establish that the device has no network activity.</p> : <ol className="space-y-2">{snapshot.connections.map(row => <li key={row.id} className="min-w-0 rounded border border-surface-700 p-3 text-xs text-surface-300">
          <p className="break-all font-medium text-surface-100">#{row.id}: {row.source} to {row.target}</p>
          <p className="mt-1 break-words">{row.protocol}, port {row.port ?? 'not recorded'} · {row.is_encrypted === true ? 'Recorded encrypted' : row.is_encrypted === false ? 'Recorded cleartext' : 'Encryption flag not recorded'}</p>
          <p className="mt-1">{row.record_reference_match ? 'Device record reference' : 'No device record reference'} · {row.ip_address_match ? 'Current IP match' : 'No current IP match'}</p>
          <details className="mt-2"><summary className="cursor-pointer text-primary-300">Recorded connection fields</summary><dl className="mt-2 space-y-2">{([['Source device ID', row.source_device_id], ['Target device ID', row.target_device_id], ['Direction', row.direction], ['Bytes transferred (exact)', row.bytes_transferred_exact], ['First seen', row.first_seen], ['Last seen', row.last_seen]] as const).map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="break-all">{value == null || value === '' ? 'Not recorded' : String(value)}{(label === 'Source device ID' || label === 'Target device ID') && typeof value === 'number' && <div className="mt-2"><DeviceRecordLink deviceId={value} /></div>}</dd></div>)}</dl></details>
        </li>)}</ol>}
        <nav aria-label="Device connection pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous connections</button><button type="button" className={control} disabled={page * snapshot.size >= snapshot.total} onClick={() => setPage(page + 1)}>Next connections</button></nav>
      </>}
    </>}
  </section>;
}
