import { useRef, useState } from 'react';
import { DeviceRecordLink } from './DeviceRecordLink';
import { useDialogFocus } from './ui/useDialogFocus';

export interface RecordedTopologyEdge {
  id: number | null; source: string; target: string; protocol: string; is_encrypted: boolean; port: number | null;
  direction?: string | null; first_seen?: string | null; last_seen?: string | null;
  bytes_transferred?: string | number | null; bytes_transferred_exact?: string | null; source_device_id?: number | null; target_device_id?: number | null;
}
export function TopologyConnectionEvidence({ edge, receivedAt, sourceLabel, targetLabel, onClose }: { edge: RecordedTopologyEdge; receivedAt: string | null; sourceLabel: string; targetLabel: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useDialogFocus(dialog, onClose);
  const bytes = edge.bytes_transferred_exact ?? (typeof edge.bytes_transferred === 'number' && !Number.isSafeInteger(edge.bytes_transferred) ? 'Numeric precision unavailable in this response' : edge.bytes_transferred);
  const fields = [['Connection record ID', edge.id], ['Source address', edge.source], ['Source label', sourceLabel], ['Source device record ID', edge.source_device_id], ['Target address', edge.target], ['Target label', targetLabel], ['Target device record ID', edge.target_device_id], ['Recorded protocol', edge.protocol], ['Recorded port', edge.port], ['Recorded direction', edge.direction], ['Recorded encryption flag', edge.is_encrypted ? 'Encrypted' : 'Cleartext'], ['Recorded bytes transferred', bytes], ['Recorded first seen', edge.first_seen], ['Recorded last seen', edge.last_seen], ['Graph response received at', receivedAt]] as const;
  const download = () => {
    setError('');
    try {
      const body = { format: 'onealert_connection_evidence_v1', scope: 'Loaded connection record, not a live reachability test, encryption verification or traffic capture. Recorded timestamps may reflect manual entry. Device labels are from the loaded graph response.', graph_response_received_at: receivedAt, source_label: sourceLabel, target_label: targetLabel,
        connection: { id: edge.id, source: edge.source, target: edge.target, protocol: edge.protocol, port: edge.port, is_encrypted: edge.is_encrypted, direction: edge.direction ?? null, first_seen: edge.first_seen ?? null, last_seen: edge.last_seen ?? null, bytes_transferred: bytes ?? null, source_device_id: edge.source_device_id ?? null, target_device_id: edge.target_device_id ?? null } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `connection-${edge.id ?? 'record'}-evidence.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('The evidence could not be downloaded. The recorded values remain visible.'); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={onClose} />
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="connection-evidence-title" className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 shadow-[var(--oa-shadow-float)]">
      <div className="flex flex-wrap items-start justify-between gap-3"><h2 id="connection-evidence-title" className="text-lg font-semibold text-surface-100">Recorded connection evidence</h2><button type="button" onClick={onClose} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Close connection evidence</button></div>
      <p className="my-3 text-xs text-surface-400">This is a loaded connection record, not a live reachability test, verified encryption or traffic capture. Recorded first/last-seen times may reflect manual entry. Direction is the stored label, not an independently verified flow direction. Inventory links use explicit recorded device references, not IP matches, and do not grant access.</p>
      <button type="button" onClick={download} className="mb-3 rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Download connection evidence JSON</button>
      {error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
      <dl className="divide-y divide-surface-700">{fields.map(([label, value]) => <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]"><dt className="text-xs text-surface-400">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-surface-100 [overflow-wrap:anywhere]">{value === undefined || value === null || value === '' ? 'Not recorded' : String(value)}{(label === 'Source device record ID' || label === 'Target device record ID') && typeof value === 'number' && <div className="mt-2"><DeviceRecordLink deviceId={value} /></div>}</dd></div>)}</dl>
    </div>
  </div>;
}
