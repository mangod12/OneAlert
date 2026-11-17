"""CISA Known Exploited Vulnerabilities (KEV) catalog integration.

Fetches the public KEV catalog once and caches it in memory; entries are
looked up per CVE for alert triage views.
"""

import time

import httpx

KEV_CATALOG_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
_CACHE_TTL_SECONDS = 6 * 60 * 60  # CISA updates the catalog a few times per week

_catalog_cache: dict[str, dict] | None = None
_catalog_fetched_at: float = 0.0


async def _fetch_catalog() -> dict[str, dict]:
    """Download the KEV catalog and index it by uppercase CVE ID."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(KEV_CATALOG_URL)
        if response.status_code != 200:
            return {}
        data = response.json()
    entries: dict[str, dict] = {}
    for item in data.get("vulnerabilities", []):
        cve = item.get("cveID")
        if not cve:
            continue
        entries[cve.upper()] = {
            "date_added": item.get("dateAdded"),
            "due_date": item.get("dueDate"),
            "known_ransomware_campaign_use": item.get("knownRansomwareCampaignUse", "Unknown"),
            "required_action": item.get("requiredAction"),
        }
    return entries


async def _get_catalog() -> dict[str, dict]:
    global _catalog_cache, _catalog_fetched_at
    now = time.monotonic()
    if _catalog_cache is not None and now - _catalog_fetched_at < _CACHE_TTL_SECONDS:
        return _catalog_cache
    try:
        entries = await _fetch_catalog()
    except (httpx.HTTPError, ValueError, TypeError):
        # Serve the stale cache when the refresh fails; otherwise empty.
        return _catalog_cache if _catalog_cache is not None else {}
    if entries:
        _catalog_cache = entries
        _catalog_fetched_at = now
    return _catalog_cache if _catalog_cache is not None else {}


async def get_kev_entries(cve_ids: list[str]) -> dict[str, dict]:
    """Return KEV catalog entries for the given CVE IDs.

    Returns:
        dict mapping CVE ID (as supplied) to its KEV entry; CVEs not in
        the catalog are omitted.
    """
    catalog = await _get_catalog()
    result: dict[str, dict] = {}
    for cve in cve_ids:
        if not cve:
            continue
        entry = catalog.get(cve.upper())
        if entry:
            result[cve] = entry
    return result


def _reset_cache() -> None:
    """Test hook: drop the cached catalog."""
    global _catalog_cache, _catalog_fetched_at
    _catalog_cache = None
    _catalog_fetched_at = 0.0
