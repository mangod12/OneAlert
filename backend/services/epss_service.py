"""EPSS (Exploit Prediction Scoring System) integration.

Fetches exploit probability scores from FIRST.org API.
"""

import httpx
from typing import Optional


EPSS_API_URL = "https://api.first.org/data/v1/epss"


async def get_epss_score(cve_id: str) -> Optional[dict]:
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
    except Exception:
        return None
