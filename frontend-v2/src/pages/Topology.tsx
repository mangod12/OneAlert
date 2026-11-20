import { validRecordedAddress } from '../utils/topologyAddress';
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { useSearchParams } from 'react-router-dom';
import { Network, Lock, LockOpen, Plus, Trash2, Download } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/Toast';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TopologyConnectionEvidence, type RecordedTopologyEdge } from '../components/TopologyConnectionEvidence';
import { TopologyEndpointIdentity, type EndpointIdentity } from '../components/TopologyEndpointIdentity';
import { topologyCsv } from '../utils/topologyCsv';

interface TopologyNode extends EndpointIdentity {
  id: string;
  label: string;
  type: string;
  zone: string | null;
  risk_score: number | null;
}

type TopologyEdge = RecordedTopologyEdge;

interface TopologyStats {
  total_connections: number;
  by_protocol: Record<string, number>;
  encrypted: number;
  unencrypted: number;
  encryption_unknown?: number;
}

export function Topology() {
  const requestId = useRef(0);
  const [statsError, setStatsError] = useState('');
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [stats, setStats] = useState<TopologyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [sourceIp, setSourceIp] = useState('');
  const [targetIp, setTargetIp] = useState('');
  const [protocol, setProtocol] = useState('');
  const [port, setPort] = useState('');
  const [direction, setDirection] = useState('bidirectional');
  const [encrypted, setEncrypted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [deletingEdge, setDeletingEdge] = useState<TopologyEdge | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [protocolFilter, setProtocolFilter] = useState('');
  const [cleartextOnly, setCleartextOnly] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedNodes = searchParams.getAll('node');
  const validNodeLink = requestedNodes.length === 1 && validRecordedAddress(requestedNodes[0]);
  const selectedNodeId = validNodeLink ? requestedNodes[0] : null;
  const invalidNodeLink = requestedNodes.length > 0 && !validNodeLink;
  const setSelectedNodeId = (value: string | null) => setSearchParams(current => { const next = new URLSearchParams(current); if (value === null) next.delete('node'); else next.set('node', value); return next; }, { replace: value === null });
  const [identityNode, setIdentityNode] = useState<TopologyNode | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<TopologyEdge | null>(null);
  const [graphReceivedAt, setGraphReceivedAt] = useState<string | null>(null);

  const fetchTopology = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true); setError(''); setStatsError(''); setSelectedConnection(null); setGraphReceivedAt(null); setIdentityNode(null);
    const [graphResult, statsResult] = await Promise.allSettled([
      apiClient.get<{ nodes: TopologyNode[]; edges: TopologyEdge[] }>('/topology/graph'),
      apiClient.get<TopologyStats>('/topology/stats'),
    ]);
    if (request !== requestId.current) return;
    if (graphResult.status === 'fulfilled') {
      setNodes(graphResult.value.data.nodes);
      setEdges(graphResult.value.data.edges);
      setGraphReceivedAt(new Date().toISOString());
    } else {
      setNodes([]); setEdges([]);
      setError(getApiErrorMessage(graphResult.reason, 'Network topology could not be loaded.'));
    }
    if (statsResult.status === 'fulfilled') setStats(statsResult.value.data);
    else {
      setStats(null);
      setStatsError(getApiErrorMessage(statsResult.reason, 'Connection statistics are unavailable.'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchTopology();
    return () => { requestId.current += 1; };
  }, [fetchTopology]);

  const resetForm = () => {
    setAdding(false);
    setSourceIp('');
    setTargetIp('');
    setProtocol('');
    setPort('');
    setDirection('bidirectional');
    setEncrypted(false);
  };

  const handleAddConnection = async () => {
    if (saving) return;
    const trimmedPort = port.trim();
    const parsedPort = trimmedPort ? Number(trimmedPort) : null;
    if (!sourceIp.trim() || !targetIp.trim() || !protocol.trim()) {
      setFormMessage({ text: 'Source IP, target IP and protocol are required.', error: true });
      return;
    }
    if (trimmedPort && (!Number.isInteger(parsedPort) || (parsedPort as number) < 0 || (parsedPort as number) > 65535)) {
      setFormMessage({ text: 'Port must be a whole number between 0 and 65535.', error: true });
      return;
    }
    setSaving(true);
    setFormMessage(null);
    try {
      await apiClient.post('/topology/connections', {
        source_ip: sourceIp.trim(),
        target_ip: targetIp.trim(),
        protocol: protocol.trim(),
        port: parsedPort,
        direction,
        is_encrypted: encrypted,
      });
      setFormMessage({ text: 'Connection recorded. The topology has been refreshed.', error: false });
      resetForm();
      await fetchTopology();
    } catch (err: unknown) {
      setFormMessage({ text: getApiErrorMessage(err, 'The connection could not be recorded.'), error: true });
    } finally {
      setSaving(false);
    }
  };

  const deleteConnection = async () => {
    if (!deletingEdge || deletingEdge.id == null || deletingBusy) return;
    setDeletingBusy(true);
    try {
      await apiClient.delete(`/topology/connections/${deletingEdge.id}`);
      toast('Connection removed. The topology has been refreshed.', 'success');
      setDeletingEdge(null);
      await fetchTopology();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The connection could not be removed.'), 'error');
    } finally {
      setDeletingBusy(false);
    }
  };

  if (loading) return <LoadingSurface rows={4} label="Loading network topology" />;
  if (error) return <ErrorState title="Topology unavailable" description={error} action={<RetryButton onClick={() => void fetchTopology()} />} />;

  const nodeLabel = (id: string) => nodes.find(n => n.id === id)?.label ?? id;
  const zones = new Map<string, TopologyNode[]>();
  for (const node of nodes) {
    const zone = node.zone ?? 'Unzoned';
    zones.set(zone, [...(zones.get(zone) ?? []), node]);
  }
  const encryptedPct = stats && stats.total_connections > 0
    ? Math.round((stats.encrypted / stats.total_connections) * 100)
    : null;
  const protocolOptions = [...new Set(edges.map(e => e.protocol))].sort();
  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) ?? null : null;
  const filteredEdges = edges.filter(e =>
    (!protocolFilter || e.protocol === protocolFilter)
    && (!cleartextOnly || e.is_encrypted === false)
    && (!selectedNodeId || e.source === selectedNodeId || e.target === selectedNodeId),
  );

  const exportConnections = () => {
    if (!filteredEdges.length || invalidNodeLink) return;
    try {
      const content = topologyCsv(filteredEdges, nodes, { protocol: protocolFilter, cleartextOnly, nodeId: selectedNodeId, receivedAt: graphReceivedAt });
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
      try {
        const link = document.createElement('a');
        link.href = url; link.download = 'topology-connections.csv'; link.click();
      } finally { URL.revokeObjectURL(url); }
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The connection snapshot could not be downloaded.'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      {selectedConnection && <TopologyConnectionEvidence edge={selectedConnection} receivedAt={graphReceivedAt} sourceLabel={nodeLabel(selectedConnection.source)} targetLabel={nodeLabel(selectedConnection.target)} onClose={() => setSelectedConnection(null)} />}
      {identityNode && <TopologyEndpointIdentity node={identityNode} onClose={() => setIdentityNode(null)} />}
      {invalidNodeLink && <div role="alert" className="oa-panel space-y-2 p-4 text-sm text-warning"><p>The topology link must contain one non-empty recorded address, without extra whitespace or control characters. No address filter was applied and export is disabled.</p><button type="button" onClick={() => setSelectedNodeId(null)} className="text-xs text-primary-300">Clear invalid topology link</button></div>}
      {selectedNodeId && <div className="oa-panel space-y-2 p-4 text-xs text-surface-300"><p className="break-all">Exact recorded-address filter: {selectedNodeId}. This compares address text only, not physical device identity, network segment or a live traffic capture.</p><button type="button" onClick={() => setSelectedNodeId(null)} className="text-primary-300">Clear recorded address filter</button>{!selectedNode && !edges.some(edge => edge.source === selectedNodeId || edge.target === selectedNodeId) && <p role="status">This address has no matching node or connection in the loaded topology. That does not prove the address or device has no activity.</p>}</div>}
      <PageHeader eyebrow="Observe" title="Network Topology" description="Observed devices, zones and connections, with encryption exposure." actions={
        <button type="button" onClick={exportConnections} disabled={filteredEdges.length === 0 || invalidNodeLink} className="flex items-center gap-2 rounded-md border border-surface-700 px-3 py-2 text-xs text-surface-200 hover:bg-surface-800 disabled:opacity-40">
          <Download className="h-4 w-4" aria-hidden="true" /> Export filtered connections
        </button>
      } />
      <p className="text-xs text-surface-400">Summary cards and device groups cover the loaded topology, not the filtered rows. CSV includes only the loaded connection rows matching the current protocol, cleartext and node filters. It is a recorded snapshot, not a live connectivity check.</p>
      {statsError && <DegradedBanner messages={[statsError]} onRetry={() => void fetchTopology()} />}

      {nodes.length === 0 && edges.length === 0 ? (
        <div className="oa-panel p-12 text-center text-surface-500">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No topology observed yet. Connections appear as sensors report traffic, or add one manually below.</p>
        </div>
      ) : (
        <>
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="oa-panel p-4">
                <p className="text-xs text-surface-500 uppercase">Connections</p>
                <p className="text-2xl font-bold text-surface-50 mt-1">{stats.total_connections}</p>
              </div>
              <div className="oa-panel p-4">
                <p className="text-xs text-surface-500 uppercase">Encrypted</p>
                <p className="text-2xl font-bold text-surface-50 mt-1">{encryptedPct === null ? 'Unavailable' : `${encryptedPct}%`}</p>
              </div>
              <div className="oa-panel p-4">
                <p className="text-xs text-surface-500 uppercase">Recorded cleartext</p>
                <p className="text-2xl font-bold mt-1" style={{ color: stats.unencrypted > 0 ? 'var(--color-danger, #f87171)' : undefined }}>
                  {stats.unencrypted}
                </p>
                <p className="mt-1 text-xs text-surface-400">Encryption flag unknown: {stats.encryption_unknown ?? 'Unavailable'}</p>
              </div>
              <div className="oa-panel p-4">
                <p className="text-xs text-surface-500 uppercase">Protocols</p>
                <p className="text-sm text-surface-300 mt-2">{Object.keys(stats.by_protocol).join(', ') || '-'}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...zones.entries()].map(([zone, zoneNodes]) => (
              <div key={zone} className="oa-panel rounded-md p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-surface-400 mb-3">{zone}</h2>
                <div className="space-y-2">
                  {zoneNodes.map(node => (
                    <div key={node.id} className="rounded-md border border-surface-700 p-2">
                    <button
                      type="button"
                      aria-pressed={selectedNodeId === node.id}
                      title="Show this node's connections"
                      onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
                      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                        selectedNodeId === node.id
                          ? 'border-primary-500/60 bg-primary-500/10 ring-1 ring-primary-500/40'
                          : 'border-surface-700 bg-surface-800/50 hover:bg-surface-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-surface-100">{node.label}</p>
                        <p className="font-mono text-xs text-surface-500">{node.id}</p>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-2">
                        <StatusBadge tone={node.type === 'gateway' ? 'info' : 'neutral'}>{node.type}</StatusBadge>
                        {node.risk_score !== null && node.risk_score >= 0 && (
                          <span className="text-xs text-surface-400">risk {Math.round(node.risk_score)}</span>
                        )}
                      </div>
                    </button>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-surface-400">{node.device_records === undefined ? 'Identity details not recorded' : node.device_records.length > 1 ? `${node.device_records.length} device records, identity ambiguous` : node.device_records.length === 1 ? 'One IP-matched device record' : 'No IP-matched device record'}</span><button type="button" aria-label={`Review identity for ${node.id}`} onClick={() => setIdentityNode(node)} className="rounded border border-surface-600 px-2 py-1.5 text-xs text-primary-300">Review identity</button></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {edges.length > 0 && (
            <div className="oa-panel overflow-hidden rounded-md">
              <div className="flex flex-wrap items-center gap-3 border-b border-surface-700 px-4 py-3">
                <label className="flex items-center gap-2 text-xs text-surface-400">
                  Protocol
                  <select
                    aria-label="Filter connections by protocol"
                    value={protocolFilter}
                    onChange={e => setProtocolFilter(e.target.value)}
                    className="rounded-md border border-surface-600 bg-surface-800 px-2 py-1.5 text-xs text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">All protocols</option>
                    {protocolOptions.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-surface-300">
                  <input
                    type="checkbox"
                    checked={cleartextOnly}
                    onChange={e => setCleartextOnly(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                  />
                  Cleartext only
                </label>
                {selectedNodeId && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-primary-500/40 bg-primary-500/10 px-2 py-1 text-xs text-primary-200">
                    Connections for {selectedNode?.label ?? selectedNodeId}
                    <button
                      type="button"
                      aria-label={`Clear node filter for ${selectedNode?.label ?? selectedNodeId}`}
                      onClick={() => setSelectedNodeId(null)}
                      className="rounded-sm px-0.5 text-primary-300 hover:text-primary-100"
                    >
                      ×
                    </button>
                  </span>
                )}
                {(protocolFilter || cleartextOnly || selectedNodeId) && (
                  <span className="text-xs text-surface-500">{filteredEdges.length} of {edges.length} connections</span>
                )}
              </div>
              <div role="region" aria-label="Topology connections" tabIndex={0} className="overflow-x-auto focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-surface-700 text-surface-400">
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">Target</th>
                    <th className="px-4 py-3 text-left">Protocol</th>
                    <th className="px-4 py-3 text-left">Port</th>
                    <th className="px-4 py-3 text-left">Encryption</th>
                    <th className="px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEdges.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-surface-500">No connections match the current filters.</td>
                    </tr>
                  )}
                  {filteredEdges.map((edge, i) => (
                    <tr key={edge.id ?? `${edge.source}-${edge.target}-${edge.protocol}-${i}`} className="border-b border-surface-700/50 hover:bg-surface-800 transition-colors">
                      <td className="px-4 py-3 text-surface-200">{nodeLabel(edge.source)}</td>
                      <td className="px-4 py-3 text-surface-200">{nodeLabel(edge.target)}</td>
                      <td className="px-4 py-3 text-surface-400 text-xs uppercase">{edge.protocol}</td>
                      <td className="px-4 py-3 text-surface-400 text-xs">{edge.port ?? '-'}</td>
                      <td className="px-4 py-3">
                        {edge.is_encrypted === true ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success"><Lock className="w-3.5 h-3.5" aria-hidden="true" />Encrypted</span>
                        ) : edge.is_encrypted === false ? (
                          <span className="inline-flex items-center gap-1 text-xs text-danger"><LockOpen className="w-3.5 h-3.5" aria-hidden="true" />Cleartext</span>
                        ) : <span className="text-xs text-surface-400">Encryption not recorded</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" aria-label={`View connection ${edge.id ?? i + 1} evidence`} onClick={() => setSelectedConnection(edge)} className="mr-2 mb-1 whitespace-nowrap rounded border border-surface-600 px-2.5 py-2 text-xs text-primary-300">View evidence</button>
                        {edge.id != null && (
                          <button
                            type="button"
                            aria-label={`Remove connection ${edge.source} to ${edge.target}`}
                            onClick={() => setDeletingEdge(edge)}
                            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-surface-600 px-2.5 text-xs text-surface-200 hover:bg-surface-800"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}
      <div className="oa-panel rounded-md p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-surface-100">Add connection</h2>
            <p className="mt-0.5 text-xs text-surface-500">Record an observed connection manually, for example from a firewall log or a one-off scan.</p>
          </div>
          {!adding && (
            <button type="button" onClick={() => { setAdding(true); setFormMessage(null); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-primary-500/40 px-3 text-sm font-semibold text-primary-300 hover:bg-primary-500/10">
              <Plus className="h-4 w-4" /> Add connection
            </button>
          )}
        </div>
        {formMessage && <div role={formMessage.error ? 'alert' : 'status'} className={`mt-3 rounded-md border px-3 py-2 text-xs ${formMessage.error ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success'}`}>{formMessage.text}</div>}
        {adding && (
          <form className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={event => { event.preventDefault(); void handleAddConnection(); }}>
            <div>
              <label htmlFor="conn-source" className="mb-1 block text-xs font-medium text-surface-300">Source IP *</label>
              <input id="conn-source" type="text" autoComplete="off" value={sourceIp} onChange={e => setSourceIp(e.target.value)} placeholder="10.0.1.12" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
            </div>
            <div>
              <label htmlFor="conn-target" className="mb-1 block text-xs font-medium text-surface-300">Target IP *</label>
              <input id="conn-target" type="text" autoComplete="off" value={targetIp} onChange={e => setTargetIp(e.target.value)} placeholder="10.0.2.40" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
            </div>
            <div>
              <label htmlFor="conn-protocol" className="mb-1 block text-xs font-medium text-surface-300">Protocol *</label>
              <input id="conn-protocol" type="text" autoComplete="off" value={protocol} onChange={e => setProtocol(e.target.value)} placeholder="modbus" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
            </div>
            <div>
              <label htmlFor="conn-port" className="mb-1 block text-xs font-medium text-surface-300">Port</label>
              <input id="conn-port" type="text" inputMode="numeric" autoComplete="off" value={port} onChange={e => setPort(e.target.value)} placeholder="502" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
            </div>
            <div>
              <label htmlFor="conn-direction" className="mb-1 block text-xs font-medium text-surface-300">Direction</label>
              <select id="conn-direction" value={direction} onChange={e => setDirection(e.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
                <option value="bidirectional">Bidirectional</option>
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label htmlFor="conn-encrypted" className="flex items-center gap-2 text-sm text-surface-300">
                <input id="conn-encrypted" type="checkbox" checked={encrypted} onChange={e => setEncrypted(e.target.checked)} className="h-4 w-4 rounded border-surface-600 bg-surface-950" />
                Encrypted
              </label>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
              <button type="submit" disabled={saving} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{saving ? 'Recording…' : 'Record connection'}</button>
              <button type="button" onClick={resetForm} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            </div>
          </form>
        )}
      </div>
      {deletingEdge && (
        <ConfirmDialog
          title="Remove connection"
          description={`Remove the ${deletingEdge.protocol} connection from ${deletingEdge.source} to ${deletingEdge.target}? It no longer appears in the topology or stats.`}
          confirmLabel="Remove connection"
          tone="danger"
          busy={deletingBusy}
          onCancel={() => setDeletingEdge(null)}
          onConfirm={() => void deleteConnection()}
        />
      )}
    </div>
  );
}
