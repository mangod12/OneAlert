"""
Tests for alert checking and matching logic.
Tests the core functionality of matching vulnerabilities to user assets.
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from backend.services.alert_checker import AlertChecker
from backend.models.user import User
from backend.models.organization import Organization  # noqa: F401 - registers SQLAlchemy relationship target
from backend.models.asset import Asset, AssetType


class TestAlertChecker:
    """Test cases for alert checking functionality."""
    
    @pytest.fixture
    def alert_checker(self):
        """Create an alert checker instance for testing."""
        return AlertChecker()
    
    @pytest.fixture
    def mock_user(self):
        """Create a mock user for testing."""
        user = Mock(spec=User)
        user.id = 1
        user.email = "test@example.com"
        user.full_name = "Test User"
        user.is_active = True
        return user
    
    @pytest.fixture
    def mock_asset(self):
        """Create a mock asset for testing."""
        asset = Mock(spec=Asset)
        asset.id = 1
        asset.name = "Test Server"
        asset.asset_type = AssetType.HARDWARE
        asset.vendor = "Cisco"
        asset.product = "ASA"
        asset.version = "9.12"
        asset.cpe_string = "cpe:2.3:h:cisco:asa:-:*:*:*:*:*:*:*"
        return asset
    
    def test_fuzzy_match_exact(self, alert_checker):
        """Test exact fuzzy matching."""
        assert alert_checker._fuzzy_match("cisco", "cisco") == True
        assert alert_checker._fuzzy_match("Microsoft", "microsoft") == True
        assert alert_checker._fuzzy_match("apache", "Apache") == True
    
    def test_fuzzy_match_substring(self, alert_checker):
        """Test substring fuzzy matching."""
        assert alert_checker._fuzzy_match("cisco systems", "cisco") == True
        assert alert_checker._fuzzy_match("microsoft", "microsoft corporation") == True
        assert alert_checker._fuzzy_match("forti", "fortinet") == True
    
    def test_fuzzy_match_aliases(self, alert_checker):
        """Test vendor alias matching."""
        assert alert_checker._fuzzy_match("microsoft", "msft") == True
        assert alert_checker._fuzzy_match("ms", "microsoft") == True
        assert alert_checker._fuzzy_match("cisco", "csco") == True
    
    def test_fuzzy_match_no_match(self, alert_checker):
        """Test when fuzzy matching should fail."""
        assert alert_checker._fuzzy_match("cisco", "juniper") == False
        assert alert_checker._fuzzy_match("microsoft", "apple") == False
        assert alert_checker._fuzzy_match("fortinet", "palo alto") == False
    
    @pytest.mark.asyncio
    async def test_is_asset_affected_by_cve_direct_cpe(self, alert_checker, mock_asset):
        """Test CVE matching with direct CPE match."""
        cve_cpes = ["cpe:2.3:h:cisco:asa:-:*:*:*:*:*:*:*"]
        cve_data = {"cve_id": "CVE-2023-1234"}
        
        is_affected = await alert_checker._is_asset_affected_by_cve(
            mock_asset, cve_cpes, cve_data
        )
        
        assert is_affected == True
    
    @pytest.mark.asyncio
    async def test_is_asset_affected_by_cve_vendor_product_match(self, alert_checker):
        """Test CVE matching with vendor/product matching."""
        asset = Mock(spec=Asset)
        asset.vendor = "Apache"
        asset.product = "HTTP Server"
        asset.version = "2.4.54"
        asset.cpe_string = None
        
        cve_cpes = ["cpe:2.3:a:apache:http_server:2.4.54:*:*:*:*:*:*:*"]
        cve_data = {"cve_id": "CVE-2023-5678"}
        
        is_affected = await alert_checker._is_asset_affected_by_cve(
            asset, cve_cpes, cve_data
        )
        
        assert is_affected == True
    
    @pytest.mark.asyncio
    async def test_is_asset_affected_by_cve_no_match(self, alert_checker):
        """Test CVE matching when asset is not affected."""
        asset = Mock(spec=Asset)
        asset.vendor = "Juniper"
        asset.product = "SRX"
        asset.version = "1.0"
        asset.cpe_string = None
        
        cve_cpes = ["cpe:2.3:a:apache:http_server:2.4.54:*:*:*:*:*:*:*"]
        cve_data = {"cve_id": "CVE-2023-5678"}
        
        is_affected = await alert_checker._is_asset_affected_by_cve(
            asset, cve_cpes, cve_data
        )
        
        assert is_affected == False
    
    @pytest.mark.asyncio
    async def test_is_asset_affected_by_vendor_advisory(self, alert_checker, mock_asset):
        """Test vendor advisory matching."""
        advisory = {
            "vendor": "Cisco",
            "vendor_advisory_id": "cisco-sa-20230101-test"
        }
        
        is_affected = await alert_checker._is_asset_affected_by_vendor_advisory(
            mock_asset, advisory
        )
        
        assert is_affected == True
    
    @pytest.mark.asyncio
    async def test_is_asset_affected_by_vendor_advisory_no_match(self, alert_checker, mock_asset):
        """Test vendor advisory matching when not affected."""
        advisory = {
            "vendor": "Microsoft",
            "vendor_advisory_id": "ms-2023-001"
        }
        
        is_affected = await alert_checker._is_asset_affected_by_vendor_advisory(
            mock_asset, advisory
        )
        
        assert is_affected == False
    
    @pytest.mark.asyncio
    async def test_find_affected_assets(self, alert_checker, mock_user, mock_asset):
        """Test finding affected assets from CVE data."""
        cve_data = {
            "cve_id": "CVE-2023-1234",
            "affected_cpes": ["cpe:2.3:h:cisco:asa:-:*:*:*:*:*:*:*"]
        }
        
        user_assets = [(mock_user, mock_asset)]
        
        affected = await alert_checker._find_affected_assets(cve_data, user_assets)
        
        assert len(affected) == 1
        assert affected[0] == (mock_user, mock_asset)
    
    @pytest.mark.asyncio
    async def test_find_affected_assets_by_vendor(self, alert_checker, mock_user, mock_asset):
        """Test finding affected assets from vendor advisory."""
        advisory = {
            "vendor": "Cisco",
            "vendor_advisory_id": "cisco-sa-20230101-test"
        }
        
        user_assets = [(mock_user, mock_asset)]
        
        affected = await alert_checker._find_affected_assets_by_vendor(
            advisory, user_assets
        )
        
        assert len(affected) == 1
        assert affected[0] == (mock_user, mock_asset)
    
    @pytest.mark.asyncio
    @patch('backend.services.alert_checker.AsyncSessionLocal')
    @patch('backend.services.alert_checker.email_service')
    @patch('backend.services.alert_checker.cve_enrichment_service.enrich_cve', new_callable=AsyncMock)
    async def test_create_alert_from_cve(self, mock_enrich, mock_email_service, mock_session_local,
                                        alert_checker, mock_user, mock_asset):
        """Test creating an alert from CVE data."""
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_session_local.return_value.__aenter__.return_value = mock_db
        mock_enrich.return_value = {}

        # Mock the result of db.execute() to be a synchronous-like mock
        mock_execution_result = MagicMock()
        mock_execution_result.scalar_one_or_none.return_value = None # No existing alert

        # Configure db.execute (which is async) to return this mock_execution_result
        mock_db.execute = AsyncMock(return_value=mock_execution_result)

        cve_data = {
            "cve_id": "CVE-2023-1234",
            "title": "Test CVE",
            "description": "Test vulnerability",
            "severity": "high",
            "cvss_score": 8.5,
            "source_url": "https://nvd.nist.gov/vuln/detail/CVE-2023-1234"
        }
        
        await alert_checker._create_alert_from_cve(mock_db, mock_user, mock_asset, cve_data)
        
        # Verify alert was added to database
        mock_db.add.assert_called_once()
        mock_db.flush.assert_called_once()
        
        # Verify email was sent
        mock_email_service.send_vulnerability_alert.assert_called_once()
    
    @pytest.mark.asyncio
    @patch('backend.services.alert_checker.AsyncSessionLocal')
    @patch('backend.services.alert_checker.email_service')
    async def test_create_alert_from_advisory(self, mock_email_service, mock_session_local,
                                             alert_checker, mock_user, mock_asset):
        """Test creating an alert from vendor advisory."""
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_session_local.return_value.__aenter__.return_value = mock_db

        # Mock the result of db.execute()
        mock_execution_result = MagicMock()
        mock_execution_result.scalar_one_or_none.return_value = None # No existing alert
        mock_db.execute = AsyncMock(return_value=mock_execution_result)

        advisory_data = {
            "vendor_advisory_id": "cisco-sa-20230101-test",
            "title": "Cisco Security Advisory",
            "description": "Test advisory",
            "severity": "medium",
            "source_url": "https://tools.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-20230101-test"
        }
        
        await alert_checker._create_alert_from_advisory(
            mock_db, mock_user, mock_asset, advisory_data
        )
        
        # Verify alert was added to database
        mock_db.add.assert_called_once()
        mock_db.flush.assert_called_once()
        
        # Verify email was sent
        mock_email_service.send_vendor_advisory_alert.assert_called_once()
    
    @pytest.mark.asyncio
    @patch('backend.services.alert_checker.cve_scraper')
    @patch('backend.services.alert_checker.vendor_scraper')
    @patch('backend.services.alert_checker.AsyncSessionLocal')
    async def test_check_new_vulnerabilities(self, mock_session_local, mock_vendor_scraper,
                                           mock_cve_scraper, alert_checker):
        """Test the main vulnerability checking process."""
        # Configure scraper mocks to be AsyncMocks returning lists
        mock_cve_scraper.fetch_recent_cves = AsyncMock(return_value=[
            {
                "cve_id": "CVE-2023-1234",
                "title": "Test CVE",
                "description": "A test CVE", # Added description
                "severity": "high", # Added severity
                "cvss_score": 7.5, # Added cvss_score
                "source_url": "http://example.com/cve", # Added source_url
                "affected_cpes": ["cpe:2.3:a:test:product:1.0:*:*:*:*:*:*:*"]
            }
        ])

        mock_vendor_scraper.fetch_all_vendor_advisories = AsyncMock(return_value=[
            {
                "vendor_advisory_id": "test-2023-001",
                "vendor": "Test Vendor",
                "title": "Test Advisory",
                "description": "A test advisory", # Added description
                "severity": "medium", # Added severity
                "source_url": "http://example.com/advisory" # Added source_url
            }
        ])

        # Mock database session
        mock_db = AsyncMock()
        mock_session_local.return_value.__aenter__.return_value = mock_db

        # Mock for the result of db.execute() that leads to .all()
        # This is for the part that fetches user_assets
        mock_execute_all_result = MagicMock() # This is the synchronous result object
        mock_execute_all_result.all.return_value = [] # .all() is a synchronous method

        # Configure db.execute (which is async) to return this mock_execute_all_result
        # This ensures that 'result.all()' in _process_cves and _process_vendor_advisories works correctly
        mock_db.execute = AsyncMock(return_value=mock_execute_all_result)
        
        await alert_checker.check_new_vulnerabilities()
        
        # Verify scrapers were called
        mock_cve_scraper.fetch_recent_cves.assert_called_once_with(hours_back=6)
        mock_vendor_scraper.fetch_all_vendor_advisories.assert_called_once_with(days_back=1)
        
        # Verify CVE was marked as processed
        assert "CVE-2023-1234" in alert_checker.processed_cves
        assert "test-2023-001" in alert_checker.processed_advisories


@pytest.mark.asyncio
async def test_alert_checker_integration():
    """Integration test for alert checker."""
    alert_checker = AlertChecker()
    
    # Test that alert checker can be instantiated
    assert alert_checker is not None
    
    # Test that processed tracking sets exist
    assert hasattr(alert_checker, 'processed_cves')
    assert hasattr(alert_checker, 'processed_advisories')
    assert isinstance(alert_checker.processed_cves, set)
    assert isinstance(alert_checker.processed_advisories, set)


if __name__ == "__main__":
    pytest.main([__file__])
