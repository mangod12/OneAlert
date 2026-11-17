"""EPSS (Exploit Prediction Scoring System) integration.

Fetches exploit probability scores from FIRST.org API.
"""


import httpx

EPSS_API_URL = "https://api.first.org/data/v1/epss"


async def get_epss_score(cve_id: str) -> dict | None:
    """Fetch EPSS score for a CVE.

    Returns:
        dict with 'score' (float 0-1) and 'percentile' (float 0-1) or None if not found.
    """
    if not cve_id:
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(EPSS_API_URL, params={"cve": cve_id})
            if response.status_code != 200:
                return None
            data = response.json()
            results = data.get("data", [])
            if not results:
                return None
            entry = results[0]
            return {
                "score": float(entry.get("epss", 0)),
                "percentile": float(entry.get("percentile", 0)),
            }
    except (httpx.HTTPError, ValueError, TypeError):
        return None

async def get_epss_scores(cve_ids: list[str]) -> dict[str, dict]:
    """Fetch EPSS scores for multiple CVEs in a single API call.

    Returns:
        dict mapping CVE ID to {'score': float, 'percentile': float};
        CVEs without EPSS data are omitted.
    """
    ids = [cve for cve in cve_ids if cve]
    if not ids:
        return {}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(EPSS_API_URL, params={"cve": ",".join(ids)})
            if response.status_code != 200:
                return {}
            data = response.json()
            scores: dict[str, dict] = {}
            for entry in data.get("data", []):
                cve = entry.get("cve")
                if not cve:
                    continue
                try:
                    scores[cve] = {
                        "score": float(entry.get("epss", 0)),
                        "percentile": float(entry.get("percentile", 0)),
                    }
                except (ValueError, TypeError):
                    continue
            return scores
    except httpx.HTTPError:
        return {}

