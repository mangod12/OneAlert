"""Parse recorded component evidence from CycloneDX and SPDX documents."""


def _objects(value, path: str) -> list[dict]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError(f"{path} must be an array of objects")
    return value


def _text(value, path: str, default=""):
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValueError(f"{path} must be text")
    return value


def _cyclonedx_licenses(value, path: str) -> str:
    choices = _objects(value, path)
    labels = []
    for index, choice in enumerate(choices):
        label_path = f"{path}[{index}]"
        if "expression" in choice:
            if len(choices) != 1 or "license" in choice:
                raise ValueError(f"{path} must contain either license entries or one expression")
            label = _text(choice["expression"], f"{label_path}.expression")
        else:
            license_record = choice.get("license")
            if not isinstance(license_record, dict):
                raise ValueError(f"{label_path}.license must be an object")
            label = _text(license_record.get("id"), f"{label_path}.license.id") or _text(
                license_record.get("name"), f"{label_path}.license.name"
            )
        if not label.strip():
            raise ValueError(f"{label_path} must include a license identifier, name or expression")
        labels.append(label)
    # A line per recorded license, not an invented AND/OR expression.
    return "\n".join(labels)


def parse_cyclonedx(data: dict) -> list[dict]:
    """Flatten component assemblies while preserving their recorded identifiers.

    Nested components are an inventory hierarchy, not dependency relationships.
    This parser supports recorded evidence fields, not full schema validation.
    """
    if data.get("bomFormat") != "CycloneDX":
        raise ValueError("bomFormat must be CycloneDX")
    _text(data.get("specVersion"), "specVersion")
    roots = _objects(data.get("components", []), "components")
    stack = [(component, f"components[{index}]") for index, component in reversed(list(enumerate(roots)))]
    components = []
    refs = set()
    while stack:
        comp, path = stack.pop()
        children = _objects(comp.get("components", []), f"{path}.components")
        stack.extend((child, f"{path}.components[{index}]") for index, child in reversed(list(enumerate(children))))
        name = _text(comp.get("name"), f"{path}.name")
        if not name.strip():
            raise ValueError(f"{path}.name must not be blank")
        bom_ref = _text(comp.get("bom-ref"), f"{path}.bom-ref")
        if bom_ref:
            if bom_ref in refs:
                raise ValueError(f"{path}.bom-ref duplicates another component reference")
            refs.add(bom_ref)
        supplier = comp.get("supplier")
        if isinstance(supplier, dict):
            supplier = supplier.get("name")
        supplier = _text(supplier, f"{path}.supplier", default=None)
        cpe = _text(comp.get("cpe"), f"{path}.cpe")
        references = _objects(comp.get("externalReferences", []), f"{path}.externalReferences")
        if not cpe:
            for ref in references:
                if ref.get("type") == "cpe":
                    cpe = _text(ref.get("url"), f"{path}.externalReferences.url")
                    break
        hash_sha256 = ""
        for hash_record in _objects(comp.get("hashes", []), f"{path}.hashes"):
            if hash_record.get("alg") == "SHA-256":
                hash_sha256 = _text(hash_record.get("content"), f"{path}.hashes.content")
                break
        components.append(
            {
                "name": name,
                "version": _text(comp.get("version"), f"{path}.version"),
                "supplier": supplier,
                "purl": _text(comp.get("purl"), f"{path}.purl"),
                "cpe": cpe,
                "license": _cyclonedx_licenses(comp.get("licenses", []), f"{path}.licenses"),
                "hash_sha256": hash_sha256,
                "bom_ref": bom_ref,
            }
        )
    return components


def parse_cyclonedx_vulnerabilities(data: dict) -> dict[str, set[str]]:
    """Map distinct embedded vulnerability IDs to their recorded component refs."""
    affects_map: dict[str, set[str]] = {}
    for index, vuln in enumerate(_objects(data.get("vulnerabilities", []), "vulnerabilities")):
        vuln_id = _text(vuln.get("id"), f"vulnerabilities[{index}].id")
        affects = _objects(vuln.get("affects", []), f"vulnerabilities[{index}].affects")
        for affect in affects:
            ref = _text(affect.get("ref"), f"vulnerabilities[{index}].affects.ref")
            if ref and vuln_id:
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

        license_str = pkg.get("licenseConcluded", "") or pkg.get("licenseDeclared", "")

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
