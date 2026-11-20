interface ExportNode { id: string; label: string; zone: string | null; }
interface ExportEdge { id: number | null; source: string; target: string; protocol: string; port: number | null; is_encrypted: boolean; }
interface ExportScope { protocol: string; cleartextOnly: boolean; nodeId: string | null; }
function cell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  let start = 0;
  while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/u.test(raw[start]))) start++;
  const safe = '=+@-'.includes(raw[start] ?? '\uffff') ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function topologyCsv(edges: ExportEdge[], nodes: ExportNode[], scope: ExportScope): string {
  const lookup = new Map(nodes.map(node => [node.id, node]));
  const rows: unknown[][] = [[
    'connection_id', 'source_ip', 'source_label', 'source_zone', 'target_ip', 'target_label', 'target_zone',
    'protocol', 'port', 'encryption', 'scope_protocol', 'scope_cleartext_only', 'scope_node_ip', 'evidence_scope',
  ]];
  for (const edge of edges) rows.push([
    edge.id, edge.source, lookup.get(edge.source)?.label ?? edge.source, lookup.get(edge.source)?.zone,
    edge.target, lookup.get(edge.target)?.label ?? edge.target, lookup.get(edge.target)?.zone,
    edge.protocol, edge.port, edge.is_encrypted ? 'encrypted' : 'cleartext',
    scope.protocol || 'all', scope.cleartextOnly, scope.nodeId, 'loaded topology snapshot, not a live connectivity check',
  ]);
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
