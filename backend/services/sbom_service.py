"""SBOM parsing and vulnerability cross-reference service.

Supports CycloneDX JSON and SPDX JSON formats, extracting component metadata
such as name, version, supplier, purl, cpe, license, and SHA-256 hashes.
"""



def parse_cyclonedx(data: dict) -> list[dict]:
    """Parse CycloneDX JSON SBOM format into component list.

    Expected format: {"bomFormat": "CycloneDX", "components": [...]}
    Each component has: name, version, supplier, purl, hashes, licenses
    """
    components = []
    raw_components = data.get("components", [])

    for comp in raw_components:
        name = comp.get("name", "")
        version = comp.get("version", "")
        bom_ref = comp.get("bom-ref", "")
        supplier = (
            comp.get("supplier", {}).get("name")
            if isinstance(comp.get("supplier"), dict)
            else comp.get("supplier")
        )
        purl = comp.get("purl", "")

        # Extract CPE from externalReferences or properties
        cpe = ""
        for ref in comp.get("externalReferences", []):
            if ref.get("type") == "cpe":
                cpe = ref.get("url", "")
                break

        # Extract license
        license_str = ""
        licenses = comp.get("licenses", [])
        if licenses:
            lic = licenses[0]
            if isinstance(lic, dict):
                license_str = lic.get("license", {}).get("id", "") or lic.get(
                    "license", {}
                ).get("name", "")

        # Extract hash
        hash_sha256 = ""
        for h in comp.get("hashes", []):
            if h.get("alg") == "SHA-256":
                hash_sha256 = h.get("content", "")
                break

        components.append(
            {
                "name": name,
                "version": version,
                "supplier": supplier,
                "purl": purl,
                "cpe": cpe,
                "license": license_str,
                "hash_sha256": hash_sha256,
                "bom_ref": bom_ref,
            }
        )

    return components


def parse_cyclonedx_vulnerabilities(data: dict) -> dict[str, set[str]]:
    """Map CycloneDX component bom-refs to the vulnerability IDs affecting them.

    Reads the optional top-level ``vulnerabilities`` array: each entry carries
    an ``id`` (e.g. a CVE) and an ``affects`` list of component bom-refs.
    """
    affects_map: dict[str, set[str]] = {}
    for vuln in data.get("vulnerabilities", []) or []:
        vuln_id = vuln.get("id")
        if not vuln_id:
            continue
        for affect in vuln.get("affects", []) or []:
            ref = affect.get("ref")
            if ref:
                affects_map.setdefault(ref, set()).add(vuln_id)
    return affects_map


def parse_spdx(data: dict) -> list[dict]:
    """Parse SPDX JSON SBOM format into component list.

    Expected format: {"spdxVersion": "SPDX-2.3", "packages": [...]}
    """
    components = []
    packages = data.get("packages", [])

    for pkg in packages:
        name = pkg.get("name", "")
        version = pkg.get("versionInfo", "")
        supplier = pkg.get("supplier", "")

        # SPDX uses externalRefs for purl/cpe
        purl = ""
        cpe = ""
        for ref in pkg.get("externalRefs", []):
            ref_type = ref.get("referenceType", "")
            if ref_type == "purl":
                purl = ref.get("referenceLocator", "")
            elif ref_type in ("cpe23Type", "cpe22Type"):
                cpe = ref.get("referenceLocator", "")

        license_str = pkg.get("licenseConcluded", "") or pkg.get(
            "licenseDeclared", ""
        )

        # Extract checksum
        hash_sha256 = ""
        for cs in pkg.get("checksums", []):
            if cs.get("algorithm") == "SHA256":
                hash_sha256 = cs.get("checksumValue", "")
                break

        components.append(
            {
                "name": name,
                "version": version,
                "supplier": supplier if supplier != "NOASSERTION" else None,
                "purl": purl,
                "cpe": cpe,
                "license": license_str if license_str != "NOASSERTION" else None,
                "hash_sha256": hash_sha256,
            }
        )

    return components
