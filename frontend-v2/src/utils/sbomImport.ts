export const MAX_SBOM_BYTES = 5 * 1024 * 1024;

export interface PreparedSbom {
  document: Record<string, unknown>;
  format: 'CycloneDX' | 'SPDX';
  version: string;
  components: number;
}

export function inspectSbomDocument(text: string): PreparedSbom {
  if (new TextEncoder().encode(text).byteLength > MAX_SBOM_BYTES) {
    throw new Error('Choose a JSON document no larger than 5 MiB for this importer.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('That is not valid JSON. Choose or paste a CycloneDX or SPDX document.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The SBOM document must be a JSON object.');
  }
  const document = parsed as Record<string, unknown>;
  let format: PreparedSbom['format'];
  let version: unknown;
  let components = 0;
  if ('bomFormat' in document) {
    if (document.bomFormat !== 'CycloneDX') throw new Error('The bomFormat value must be CycloneDX.');
    format = 'CycloneDX'; version = document.specVersion;
    const pending: unknown[] = [document.components === undefined ? [] : document.components];
    while (pending.length) {
      const group = pending.pop();
      if (!Array.isArray(group)) throw new Error('CycloneDX components must be arrays of component objects.');
      for (const component of group) {
        if (!component || typeof component !== 'object' || Array.isArray(component)) {
          throw new Error('CycloneDX components must be arrays of component objects.');
        }
        components += 1;
        if ('components' in component) pending.push(component.components);
      }
    }
  } else if (typeof document.spdxVersion === 'string' && document.spdxVersion.startsWith('SPDX-')) {
    format = 'SPDX'; version = document.spdxVersion;
    const packages = document.packages === undefined ? [] : document.packages;
    if (!Array.isArray(packages) || packages.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error('SPDX packages must be an array of package objects.');
    }
    components = packages.length;
  } else throw new Error('Use a bomFormat (CycloneDX) or spdxVersion (SPDX) document.');
  if (version != null && typeof version !== 'string') throw new Error('The document format version must be text.');
  return { document, format, version: typeof version === 'string' ? version : 'Version not recorded', components };
}
