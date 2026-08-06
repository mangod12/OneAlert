"""
Vendor-specific scraper service for fetching security advisories.
Handles scraping from various vendor security advisory feeds (Cisco, Fortinet, etc.).
"""

import asyncio
import logging
from typing import List, Dict, Optional
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class VendorScraper:
    """Scraper for vendor security advisories."""
    
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
    
    async def fetch_cisco_advisories(self, days_back: int = 7) -> List[Dict]:
        """Fetch recent Cisco security advisories."""
        try:
            # Cisco PSIRT OpenVuln API would be ideal, but requires registration
            # For demo purposes, we'll scrape the public advisories page
            url = "https://tools.cisco.com/security/center/publicationListing.x"
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'html.parser')
                advisories = []
                
                # Parse advisory listings (this would need to be adapted to actual Cisco page structure)
                advisory_rows = soup.find_all('tr', class_='advisory-row')  # Example selector
                
                for row in advisory_rows[:20]:  # Limit to recent advisories
                    advisory = self._parse_cisco_advisory_row(row)
                    if advisory:
                        advisories.append(advisory)
                
                logger.info(f"Fetched {len(advisories)} Cisco advisories")
                return advisories
                
        except Exception as e:
            logger.error(f"Error fetching Cisco advisories: {e}")
            return []
    
    async def fetch_fortinet_advisories(self, days_back: int = 7) -> List[Dict]:
        """Fetch recent Fortinet security advisories."""
        try:
            # Fortinet PSIRT advisories
            url = "https://www.fortiguard.com/psirt"
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'html.parser')
                advisories = []
                
                # Parse advisory listings
                advisory_items = soup.find_all('div', class_='psirt-item')  # Example selector
                
                for item in advisory_items[:20]:
                    advisory = self._parse_fortinet_advisory_item(item)
                    if advisory:
                        advisories.append(advisory)
                
                logger.info(f"Fetched {len(advisories)} Fortinet advisories")
                return advisories
                
        except Exception as e:
            logger.error(f"Error fetching Fortinet advisories: {e}")
            return []
    
    async def fetch_microsoft_advisories(self, days_back: int = 7) -> List[Dict]:
        """Fetch recent Microsoft security advisories."""
        try:
            # Microsoft Security Response Center API
            url = "https://api.msrc.microsoft.com/cvrf/v2.0/updates"
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                data = response.json()
                advisories = []
                
                # Parse Microsoft security updates
                for update in data.get('value', [])[:20]:
                    advisory = self._parse_microsoft_update(update)
                    if advisory:
                        advisories.append(advisory)
                
                logger.info(f"Fetched {len(advisories)} Microsoft advisories")
                return advisories
                
        except Exception as e:
            logger.error(f"Error fetching Microsoft advisories: {e}")
            return []
    
    def _parse_cisco_advisory_row(self, row) -> Optional[Dict]:
        """Parse a Cisco advisory row."""
        try:
            # Extract advisory information from HTML row
            # This would need to be adapted to actual Cisco page structure
            advisory_id_elem = row.find('a', class_='advisory-id')
            title_elem = row.find('span', class_='advisory-title')
            severity_elem = row.find('span', class_='severity')
            date_elem = row.find('span', class_='date')
            
            if not all([advisory_id_elem, title_elem]):
                return None
            
            advisory_id = advisory_id_elem.get_text(strip=True)
            title = title_elem.get_text(strip=True)
            severity = severity_elem.get_text(strip=True) if severity_elem else "unknown"
            date_text = date_elem.get_text(strip=True) if date_elem else ""
            
            # Convert severity to standard format
            severity_map = {
                "Critical": "critical",
                "High": "high", 
                "Medium": "medium",
                "Low": "low"
            }
            severity = severity_map.get(severity, "unknown")
            
            return {
                "vendor_advisory_id": advisory_id,
                "title": title,
                "description": f"Cisco Security Advisory: {title}",
                "severity": severity,
                "vendor": "Cisco",
                "published_date": date_text,
                "source_url": f"https://tools.cisco.com/security/center/content/CiscoSecurityAdvisory/{advisory_id}",
                "affected_products": []  # Would need additional parsing
            }
            
        except Exception as e:
            logger.error(f"Error parsing Cisco advisory row: {e}")
            return None
    
    def _parse_fortinet_advisory_item(self, item) -> Optional[Dict]:
        """Parse a Fortinet advisory item."""
        try:
            # Extract Fortinet advisory information
            advisory_id_elem = item.find('span', class_='psirt-id')
            title_elem = item.find('h3', class_='psirt-title')
            severity_elem = item.find('span', class_='severity-badge')
            
            if not all([advisory_id_elem, title_elem]):
                return None
            
            advisory_id = advisory_id_elem.get_text(strip=True)
            title = title_elem.get_text(strip=True)
            severity = severity_elem.get_text(strip=True).lower() if severity_elem else "unknown"
            
            return {
                "vendor_advisory_id": advisory_id,
                "title": title,
                "description": f"Fortinet Security Advisory: {title}",
                "severity": severity,
                "vendor": "Fortinet",
                "published_date": "",
                "source_url": f"https://www.fortiguard.com/psirt/{advisory_id}",
                "affected_products": []
            }
            
        except Exception as e:
            logger.error(f"Error parsing Fortinet advisory: {e}")
            return None
    
    def _parse_microsoft_update(self, update) -> Optional[Dict]:
        """Parse a Microsoft security update."""
        try:
            update_id = update.get('ID', '')
            title = update.get('Title', '')
            severity = update.get('Severity', {}).get('Description', 'unknown').lower()
            
            # Map Microsoft severity to standard format
            if 'critical' in severity:
                severity = 'critical'
            elif 'important' in severity:
                severity = 'high'
            elif 'moderate' in severity:
                severity = 'medium'
            elif 'low' in severity:
                severity = 'low'
            else:
                severity = 'unknown'
            
            return {
                "vendor_advisory_id": update_id,
                "title": title,
                "description": f"Microsoft Security Update: {title}",
                "severity": severity,
                "vendor": "Microsoft",
                "published_date": update.get('InitialReleaseDate', ''),
                "source_url": f"https://msrc.microsoft.com/update-guide/vulnerability/{update_id}",
                "affected_products": []
            }
            
        except Exception as e:
            logger.error(f"Error parsing Microsoft update: {e}")
            return None
    
    async def fetch_all_vendor_advisories(self, days_back: int = 7) -> List[Dict]:
        """Fetch advisories from all supported vendors."""
        try:
            tasks = [
                self.fetch_cisco_advisories(days_back),
                self.fetch_fortinet_advisories(days_back),
                self.fetch_microsoft_advisories(days_back)
            ]
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            all_advisories = []
            for result in results:
                if isinstance(result, list):
                    all_advisories.extend(result)
                elif isinstance(result, Exception):
                    logger.error(f"Vendor scraper error: {result}")
            
            logger.info(f"Fetched total of {len(all_advisories)} vendor advisories")
            return all_advisories
            
        except Exception as e:
            logger.error(f"Error fetching vendor advisories: {e}")
            return []


# Global scraper instance
vendor_scraper = VendorScraper()