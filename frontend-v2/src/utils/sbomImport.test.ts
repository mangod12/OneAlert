import { describe, expect, it } from 'vitest';
import { inspectSbomDocument, MAX_SBOM_BYTES } from './sbomImport';

describe('SBOM document preview', () => {
  it('counts nested assemblies without changing or filtering the submitted document', () => {
    const document = { bomFormat: 'CycloneDX', specVersion: '1.6', components: [
      { name: 'assembly', components: [{ name: 'part', components: [{ name: 'leaf' }] }] }, { name: 'sibling' },
    ], properties: [{ name: 'vendor-evidence', value: 'retained' }] };
    const result = inspectSbomDocument(JSON.stringify(document));
    expect(result.components).toBe(4);
    expect(result.document).toEqual(document);
    expect(result.version).toBe('1.6');
  });
  it('accepts a UTF-8 BOM and counts SPDX packages', () => {
    expect(inspectSbomDocument('\uFEFF{"spdxVersion":"SPDX-2.3","packages":[{"name":"lib"}]}')).toMatchObject({ format: 'SPDX', components: 1 });
  });
  it('accepts an empty inventory but does not invent a version', () => {
    expect(inspectSbomDocument('{"bomFormat":"CycloneDX"}')).toMatchObject({ components: 0, version: 'Version not recorded' });
  });
  it.each(['null', '[]', '7', '{', '{"bomFormat":"Other"}', '{"spdxVersion":{}}', '{"bomFormat":"CycloneDX","components":[null]}', '{"bomFormat":"CycloneDX","components":[{"components":{}}]}', '{"spdxVersion":"SPDX-2.3","packages":[[]]}', '{"bomFormat":"CycloneDX","specVersion":{}}'])('rejects unsupported structure: %s', text => {
    expect(() => inspectSbomDocument(text)).toThrow();
  });
  it('measures UTF-8 bytes instead of character count', () => {
    expect(() => inspectSbomDocument(JSON.stringify({ bomFormat: 'CycloneDX', text: '界'.repeat(Math.ceil(MAX_SBOM_BYTES / 3)) }))).toThrow('5 MiB');
  });
});
