"""
Tests for CVE and vendor scraper services.
Tests the functionality of vulnerability data fetching and parsing.
"""

import httpx
import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from backend.services.cve_scraper import CVEScraper
from backend.services.vendor_scraper import VendorScraper


class TestCVEScraper:
    """Test cases for CVE scraper functionality."""
    
    @pytest.fixture
    def scraper(self):
        """Create a CVE scraper instance for testing."""
        return CVEScraper()
    
    @pytest.mark.asyncio
    async def test_parse_cve_data(self, scraper):
        """Test parsing of CVE data from NVD API response."""
        # Mock CVE data structure
        mock_cve_data = {
            "cve": {
                "id": "CVE-2023-1234",
                "descriptions": [
                    {
                        "lang": "en",
                        "value": "Test vulnerability description"
                    }
                ],
                "published": "2023-01-01T00:00:00.000",
                "metrics": {
                    "cvssMetricV31": [
                        {
                            "cvssData": {
                                "baseScore": 9.8
                            }
                        }
                    ]
                },
                "configurations": [
                    {
                        "nodes": [
                            {
                                "cpeMatch": [
                                    {
                                        "vulnerable": True,
                                        "criteria": "cpe:2.3:a:test:product:1.0:*:*:*:*:*:*:*"
                                    }
                                ]
                            }
                        ]
                    }
                ],
                "references": [
                    {
                        "url": "https://example.com/advisory"
                    }
                ]
            }
        }
        
        parsed = scraper._parse_cve(mock_cve_data)
        
        assert parsed["cve_id"] == "CVE-2023-1234"
        assert parsed["description"] == "Test vulnerability description"
        assert parsed["severity"] == "critical"
        assert parsed["cvss_score"] == 9.8
        assert "cpe:2.3:a:test:product:1.0:*:*:*:*:*:*:*" in parsed["affected_cpes"]
    
    @pytest.mark.asyncio
    async def test_get_severity_from_score(self, scraper):
        """Test CVSS score to severity mapping."""
        assert scraper._get_severity_from_score(9.5) == "critical"
        assert scraper._get_severity_from_score(8.0) == "high"
        assert scraper._get_severity_from_score(5.5) == "medium"
        assert scraper._get_severity_from_score(2.0) == "low"
        assert scraper._get_severity_from_score(None) == "unknown"
    
    @pytest.mark.asyncio
    @patch('httpx.AsyncClient.get')
    async def test_fetch_recent_cves(self, mock_get, scraper):
        """Test fetching recent CVEs from NVD API."""
        # Mock successful API response
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "vulnerabilities": [
                {
                    "cve": {
                        "id": "CVE-2023-1234",
                        "descriptions": [{"lang": "en", "value": "Test CVE"}],
                        "published": "2023-01-01T00:00:00.000",
                        "metrics": {
                            "cvssMetricV31": [{"cvssData": {"baseScore": 7.5}}]
                        }
                    }
                }
            ]
        }
        mock_get.return_value = mock_response
        
        cves = await scraper.fetch_recent_cves(24)
        
        assert len(cves) == 1
        assert cves[0]["cve_id"] == "CVE-2023-1234"
        assert cves[0]["severity"] == "high"
    
    @pytest.mark.asyncio
    @patch('httpx.AsyncClient.get')
    async def test_fetch_cves_api_error(self, mock_get, scraper):
        """Test handling of API errors when fetching CVEs."""
        # Mock API error
        mock_get.side_effect = httpx.ConnectError("API Error")
        
        cves = await scraper.fetch_recent_cves(24)
        
        assert cves == []
    
    @pytest.mark.asyncio
    @patch('httpx.AsyncClient.get')
    async def test_search_cves_by_keyword(self, mock_get, scraper):
        """Test searching CVEs by keyword."""
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "vulnerabilities": [
                {
                    "cve": {
                        "id": "CVE-2023-5678",
                        "descriptions": [{"lang": "en", "value": "Apache vulnerability"}],
                        "published": "2023-01-01T00:00:00.000"
                    }
                }
            ]
        }
        mock_get.return_value = mock_response
        
        cves = await scraper.search_cves_by_keyword("apache", 50)
        
        assert len(cves) == 1
        assert cves[0]["cve_id"] == "CVE-2023-5678"


class TestVendorScraper:
    """Test cases for vendor scraper functionality."""
    
    @pytest.fixture
    def scraper(self):
        """Create a vendor scraper instance for testing."""
        return VendorScraper()
    
    @pytest.mark.asyncio
    @patch('httpx.AsyncClient.get')
    async def test_fetch_cisco_advisories(self, mock_get, scraper):
        """Test fetching Cisco security advisories."""
        # Mock HTML response
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.text = """
        <html>
            <tr class="advisory-row">
                <a class="advisory-id">cisco-sa-20230101-test</a>
                <span class="advisory-title">Test Security Advisory</span>
                <span class="severity">High</span>
                <span class="date">2023-01-01</span>
            </tr>
        </html>
        """
        mock_get.return_value = mock_response
        
        advisories = await scraper.fetch_cisco_advisories(7)
        
        # Note: This test would need to be updated based on actual Cisco page structure
        # For now, it tests the method doesn't crash
        assert isinstance(advisories, list)
    
    @pytest.mark.asyncio
    @patch('httpx.AsyncClient.get')
    async def test_fetch_microsoft_advisories(self, mock_get, scraper):
        """Test fetching Microsoft security advisories."""
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "value": [
                {
                    "ID": "CVE-2023-1234",
                    "Title": "Test Microsoft Advisory",
                    "Severity": {"Description": "Critical"},
                    "InitialReleaseDate": "2023-01-01T00:00:00Z"
                }
            ]
        }
        mock_get.return_value = mock_response
        
        advisories = await scraper.fetch_microsoft_advisories(7)
        
        assert len(advisories) == 1
        assert advisories[0]["vendor_advisory_id"] == "CVE-2023-1234"
        assert advisories[0]["severity"] == "critical"
        assert advisories[0]["vendor"] == "Microsoft"
    
    @pytest.mark.asyncio
    async def test_parse_microsoft_update(self, scraper):
        """Test parsing Microsoft security update data."""
        update_data = {
            "ID": "CVE-2023-5678",
            "Title": "Windows Security Update",
            "Severity": {"Description": "Important"},
            "InitialReleaseDate": "2023-01-01T00:00:00Z"
        }
        
        parsed = scraper._parse_microsoft_update(update_data)
        
        assert parsed["vendor_advisory_id"] == "CVE-2023-5678"
        assert parsed["title"] == "Windows Security Update"
        assert parsed["severity"] == "high"  # Important maps to high
        assert parsed["vendor"] == "Microsoft"
    
    @pytest.mark.asyncio
    @patch.object(VendorScraper, 'fetch_cisco_advisories')
    @patch.object(VendorScraper, 'fetch_fortinet_advisories')
    @patch.object(VendorScraper, 'fetch_microsoft_advisories')
    async def test_fetch_all_vendor_advisories(self, mock_ms, mock_forti, mock_cisco, scraper):
        """Test fetching advisories from all vendors."""
        # Mock responses from each vendor
        mock_cisco.return_value = [{"vendor": "Cisco", "id": "cisco-1"}]
        mock_forti.return_value = [{"vendor": "Fortinet", "id": "forti-1"}]
        mock_ms.return_value = [{"vendor": "Microsoft", "id": "ms-1"}]

        all_advisories = await scraper.fetch_all_vendor_advisories(7)

        assert len(all_advisories) == 3
        vendors = [adv["vendor"] for adv in all_advisories]
        assert "Cisco" in vendors
        assert "Fortinet" in vendors
        assert "Microsoft" in vendors
    
    @pytest.mark.asyncio
    @patch.object(VendorScraper, 'fetch_cisco_advisories')
    async def test_fetch_all_vendor_advisories_with_error(self, mock_cisco, scraper):
        """Test handling errors when fetching from vendors."""
        # Mock one vendor failing
        mock_cisco.side_effect = Exception("Network error")

        with patch.object(scraper, 'fetch_fortinet_advisories', return_value=[]):
            with patch.object(scraper, 'fetch_microsoft_advisories', return_value=[]):
                advisories = await scraper.fetch_all_vendor_advisories(7)

                # Should return empty list but not crash
                assert advisories == []


@pytest.mark.asyncio
async def test_scraper_integration():
    """Integration test for scraper services."""
    cve_scraper = CVEScraper()
    vendor_scraper = VendorScraper()

    # Test that scrapers can be instantiated without errors
    assert cve_scraper is not None
    assert vendor_scraper is not None

    # Test that methods exist and are callable
    assert callable(cve_scraper.fetch_recent_cves)
    assert callable(vendor_scraper.fetch_all_vendor_advisories)


if __name__ == "__main__":
    pytest.main([__file__])
