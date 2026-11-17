"""
CVE enrichment service for fetching extra data from NVD or VulDB.
"""
import logging

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

class CVEEnrichmentService:
    def __init__(self):
        self.nvd_api_key = settings.nvd_api_key
        self.nvd_base_url = "https://services.nvd.nist.gov/rest/json/cve/1.0/"
        # VulDB API details can be added here

    async def enrich_cve(self, cve_id: str) -> dict:
        """Fetch enrichment data for a CVE from NVD."""
        try:
            headers = {"User-Agent": "CyberSecAlert/1.0"}
            if self.nvd_api_key:
                headers["apiKey"] = self.nvd_api_key
            async with httpx.AsyncClient() as client:
                resp = await client.get(f"{self.nvd_base_url}{cve_id}", headers=headers)
                resp.raise_for_status()
                data = resp.json()
                # Parse and return enrichment fields (CVSS, exploitability, remediation, etc)
                # Example stub (real implementation should parse NVD response properly):
                cve_items = data.get("result", {}).get("CVE_Items", [{}])
                if cve_items:
                    item = cve_items[0]
                    impact = item.get("impact", {})
                    base_metric = impact.get("baseMetricV3", {})
                    cvss = base_metric.get("cvssV3", {})
                    references = item.get("cve", {}).get("references", {}).get("reference_data", [{}])
                    return {
                        "cvss_score": cvss.get("baseScore"),
                        "exploitability": base_metric.get("exploitabilityScore"),
                        "remediation": references[0].get("url") if references else None
                    }
                return {}
        except Exception as e:
            logger.error(f"CVE enrichment failed for {cve_id}: {e}")
            return {}
