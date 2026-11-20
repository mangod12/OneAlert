export interface ComponentEvidence {
  id: number;
  sbom_id: number;
  name: string;
  version: string | null;
  supplier: string | null;
  purl: string | null;
  cpe: string | null;
  license: string | null;
  hash_sha256?: string | null;
  has_known_vulnerability: number;
}
export type EvidenceGap = '' | 'version' | 'supplier' | 'identifier' | 'license' | 'hash';
export const evidenceGapLabels: Record<Exclude<EvidenceGap, ''>, string> = {
  version: 'Missing version', supplier: 'Missing supplier', identifier: 'Missing PURL and CPE',
  license: 'Missing or unspecified license', hash: 'Missing SHA-256',
};
export const hasRecordedValue = (value?: string | null) => !!value?.trim() && !['NOASSERTION', 'NONE'].includes(value.trim().toUpperCase());
export function hasEvidenceGap(component: ComponentEvidence, gap: EvidenceGap): boolean {
  if (!gap) return true;
  if (gap === 'identifier') return !hasRecordedValue(component.purl) && !hasRecordedValue(component.cpe);
  return !hasRecordedValue(component[gap === 'hash' ? 'hash_sha256' : gap]);
}
export function evidenceGapCounts(components: ComponentEvidence[]): Record<Exclude<EvidenceGap, ''>, number> {
  return Object.fromEntries(Object.keys(evidenceGapLabels).map(gap => [gap, components.filter(component => hasEvidenceGap(component, gap as EvidenceGap)).length])) as Record<Exclude<EvidenceGap, ''>, number>;
}
export interface EvidenceSnapshot {
  sbom: { id: number; asset_id: number; format: string; version: string | null; source: string; created_at: string; component_count: number };
  components: ComponentEvidence[];
  loadedCount: number;
  filters: { search: string; recordedVulnerabilitiesOnly: boolean; evidenceGap: EvidenceGap };
  exportedAt: string;
}
export function componentEvidenceJson(snapshot: EvidenceSnapshot): string {
  return JSON.stringify({ format: 'onealert_sbom_component_evidence_v1', scope: 'Recorded component evidence only. Not a live vulnerability scan, verified package hash, legal license assessment or dependency graph.', exported_at: snapshot.exportedAt, sbom: snapshot.sbom, loaded_component_count: snapshot.loadedCount, exported_component_count: snapshot.components.length, filters: snapshot.filters,
    components: snapshot.components.map(component => ({ id: component.id, sbom_id: component.sbom_id, name: component.name, version: component.version, supplier: component.supplier, purl: component.purl, cpe: component.cpe, license: component.license, hash_sha256: component.hash_sha256 ?? null, recorded_vulnerability_reference_count: component.has_known_vulnerability })) }, null, 2) + '\n';
}
const csvCell = (value: unknown) => {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function componentEvidenceCsv(snapshot: EvidenceSnapshot): string {
  const header = ['sbom_id', 'asset_id', 'component_id', 'name', 'version', 'supplier', 'purl', 'cpe', 'license', 'hash_sha256', 'recorded_vulnerability_references', 'sbom_uploaded_at', 'exported_at'];
  const rows = snapshot.components.map(component => [snapshot.sbom.id, snapshot.sbom.asset_id, component.id, component.name, component.version, component.supplier, component.purl, component.cpe, component.license, component.hash_sha256, component.has_known_vulnerability, snapshot.sbom.created_at, snapshot.exportedAt]);
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
