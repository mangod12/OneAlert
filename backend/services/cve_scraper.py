"""
CVE scraper service for fetching vulnerability data from NVD (NIST).
Retrieves CVE data and processes it for matching against user assets.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
import httpx
from backend.config import settings

logger = logging.getLogger(__name__)


class CVEScraper:
    """Scraper for CVE data from NIST NVD API."""
    
    def __init__(self):
        self.base_url = "https://services.nvd.nist.gov/rest/json/cves/2.0"
        self.api_key = settings.nvd_api_key
        self.headers = {
            "User-Agent": f"{settings.app_name}/{settings.app_version}"
        }
        if self.api_key:
            self.headers["apiKey"] = self.api_key
    
    async def fetch_recent_cves(self, hours_back: int = 24) -> List[Dict]:
        """Fetch CVEs published in the last N hours."""
        try:
            # Calculate time range
            end_time = datetime.now(timezone.utc)
            start_time = end_time - timedelta(hours=hours_back)
            
            # Format times for API
            start_time_str = start_time.strftime("%Y-%m-%dT%H:%M:%S.000")
            end_time_str = end_time.strftime("%Y-%m-%dT%H:%M:%S.000")
            
            params = {
                "pubStartDate": start_time_str,
                "pubEndDate": end_time_str,
                "resultsPerPage": 2000  # Maximum allowed
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    self.base_url,
                    headers=self.headers,
                    params=params
                )
                response.raise_for_status()
                
                data = response.json()
                cves = data.get("vulnerabilities", [])
                
                logger.info(f"Fetched {len(cves)} CVEs from {start_time_str} to {end_time_str}")
                
                return [self._parse_cve(cve) for cve in cves]
                
        except Exception as e:
            logger.error(f"Error fetching CVEs: {e}")
            return []
    
    async def fetch_cve_by_id(self, cve_id: str) -> Optional[Dict]:
        """Fetch a specific CVE by ID."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.base_url}",
                    headers=self.headers,
                    params={"cveId": cve_id}
                )
                response.raise_for_status()
                
                data = response.json()
                vulnerabilities = data.get("vulnerabilities", [])
                
                if vulnerabilities:
                    return self._parse_cve(vulnerabilities[0])
                
                return None
                
        except Exception as e:
            logger.error(f"Error fetching CVE {cve_id}: {e}")
            return None
    
    def _parse_cve(self, cve_data: Dict) -> Dict:
        """Parse CVE data into standardized format."""
        try:
            cve = cve_data.get("cve", {})
            cve_id = cve.get("id", "")
            
            # Extract description
            descriptions = cve.get("descriptions", [])
            description = ""
            for desc in descriptions:
                if desc.get("lang") == "en":
                    description = desc.get("value", "")
                    break
            
            # Extract CVSS score
            metrics = cve_data.get("cve", {}).get("metrics", {})
            cvss_score = None
            severity = "unknown"
            
            # Try CVSS v3.1 first, then v3.0, then v2.0
            for cvss_version in ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]:
                if cvss_version in metrics and metrics[cvss_version]:
                    cvss_data = metrics[cvss_version][0]
                    if "cvssData" in cvss_data:
                        cvss_score = cvss_data["cvssData"].get("baseScore")
                        severity = self._get_severity_from_score(cvss_score)
                        break
            
            # Extract affected products (CPEs)
            configurations = cve.get("configurations", [])
            affected_cpes = []
            
            for config in configurations:
                nodes = config.get("nodes", [])
                for node in nodes:
                    cpe_matches = node.get("cpeMatch", [])
                    for cpe_match in cpe_matches:
                        if cpe_match.get("vulnerable", False):
                            affected_cpes.append(cpe_match.get("criteria", ""))
            
            # Extract references
            references = cve.get("references", [])
            reference_urls = [ref.get("url", "") for ref in references]
            
            # Get published date
            published = cve.get("published", "")
            
            return {
                "cve_id": cve_id,
                "title": f"CVE {cve_id}",
                "description": description,
                "severity": severity,
                "cvss_score": cvss_score,
                "published_date": published,
                "affected_cpes": affected_cpes,
                "references": reference_urls,
                "source_url": f"https://nvd.nist.gov/vuln/detail/{cve_id}"
            }
            
        except Exception as e:
            logger.error(f"Error parsing CVE data: {e}")
            return {}
    
    def _get_severity_from_score(self, cvss_score: float) -> str:
        """Convert CVSS score to severity level."""
        if cvss_score is None:
            return "unknown"
        
        if cvss_score >= 9.0:
            return "critical"
        elif cvss_score >= 7.0:
            return "high"
        elif cvss_score >= 4.0:
            return "medium"
        else:
            return "low"
    
    async def search_cves_by_keyword(self, keyword: str, limit: int = 100) -> List[Dict]:
        """Search CVEs by keyword."""
        try:
            params = {
                "keywordSearch": keyword,
                "resultsPerPage": min(limit, 2000)
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    self.base_url,
                    headers=self.headers,
                    params=params
                )
                response.raise_for_status()
                
                data = response.json()
                cves = data.get("vulnerabilities", [])
                
                logger.info(f"Found {len(cves)} CVEs for keyword '{keyword}'")
                
                return [self._parse_cve(cve) for cve in cves]
                
        except Exception as e:
            logger.error(f"Error searching CVEs for keyword '{keyword}': {e}")
            return []


# Global scraper instance
cve_scraper = CVEScraper()