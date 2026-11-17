import { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/client';
import { Network, Lock, LockOpen } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';

interface TopologyNode {
  id: string;
  label: string;
  type: string;
  zone: string | null;
  risk_score: number;
}

interface TopologyEdge {
  source: string;
  target: string;
  protocol: string;
  is_encrypted: boolean;
  port: number | null;
}

interface TopologyStats {
  total_connections: number;
  by_protocol: Record<string, number>;
  encrypted: number;
  unencrypted: number;
}

export function Topology() {
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [stats, setStats] = useState<TopologyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTopology = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [graphRes, statsRes] = await Promise.all([
        apiClient.get<{ nodes: TopologyNode[]; edges: TopologyEdge[] }>('/topology/graph'),
        apiClient.get<TopologyStats>('/topology/stats'),
      ]);
      setNodes(graphRes.data.nodes);
      setEdges(graphRes.data.edges);
      setStats(statsRes.data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Network topology could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchTopology(); }, [fetchTopology]);

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
    : 100;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Observe" title="Network Topology" description="Observed devices, zones and connections, with encryption exposure." />

      {nodes.length === 0 && edges.length === 0 ? (
        <div className="oa-panel p-12 text-center text-surface-500">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No topology observed yet. Connections appear as sensors report traffic.</p>
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
                <p className="text-2xl font-bold text-surface-50 mt-1">{encryptedPct}%</p>
              </div>
              <div className="oa-panel p-4">
                <p className="text-xs text-surface-500 uppercase">Unencrypted</p>
                <p className="text-2xl font-bold mt-1" style={{ color: stats.unencrypted > 0 ? 'var(--color-danger, #f87171)' : undefined }}>
                  {stats.unencrypted}
                </p>
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
                    <div key={node.id} className="flex items-center justify-between rounded-md border border-surface-700 bg-surface-800/50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-surface-100">{node.label}</p>
                        <p className="font-mono text-xs text-surface-500">{node.id}</p>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-2">
                        <StatusBadge tone={node.type === 'gateway' ? 'info' : 'neutral'}>{node.type}</StatusBadge>
                        {node.risk_score > 0 && (
                          <span className="text-xs text-surface-400">risk {Math.round(node.risk_score)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {edges.length > 0 && (
            <div className="oa-panel overflow-hidden rounded-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-700 text-surface-400">
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">Target</th>
                    <th className="px-4 py-3 text-left">Protocol</th>
                    <th className="px-4 py-3 text-left">Port</th>
                    <th className="px-4 py-3 text-left">Encryption</th>
                  </tr>
                </thead>
                <tbody>
                  {edges.map((edge, i) => (
                    <tr key={`${edge.source}-${edge.target}-${edge.protocol}-${i}`} className="border-b border-surface-700/50 hover:bg-surface-800 transition-colors">
                      <td className="px-4 py-3 text-surface-200">{nodeLabel(edge.source)}</td>
                      <td className="px-4 py-3 text-surface-200">{nodeLabel(edge.target)}</td>
                      <td className="px-4 py-3 text-surface-400 text-xs uppercase">{edge.protocol}</td>
                      <td className="px-4 py-3 text-surface-400 text-xs">{edge.port ?? '-'}</td>
                      <td className="px-4 py-3">
                        {edge.is_encrypted ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success"><Lock className="w-3.5 h-3.5" aria-hidden="true" />Encrypted</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-danger"><LockOpen className="w-3.5 h-3.5" aria-hidden="true" />Cleartext</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
