from functools import lru_cache

import requests

NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cve/1.0/"

@lru_cache(maxsize=1024)
def enrich_cve(cve_id: str) -> dict:
    url = NVD_API_URL + cve_id
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        # Extract CVSS and exploitability info
        cve_item = data.get('result', {}).get('CVE_Items', [{}])[0]
        impact = cve_item.get('impact', {})
        base_metric = impact.get('baseMetricV3', {})
        cvss = base_metric.get('cvssV3', {})
        return {
            'cvss_score': cvss.get('baseScore'),
            'cvss_vector': cvss.get('vectorString'),
            'exploitability': base_metric.get('exploitabilityScore'),
        }
    except (requests.RequestException, ValueError, TypeError, KeyError) as e:
        return {'error': str(e)}
