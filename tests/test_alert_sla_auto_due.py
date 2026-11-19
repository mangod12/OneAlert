"""New alerts get severity-based SLA due dates when the user enables them."""

from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from backend.models.asset import Asset, AssetType
from backend.models.organization import Organization  # noqa: F401 - registers SQLAlchemy relationship target
from backend.models.discovered_device import NetworkSensor  # noqa: F401 - registers SQLAlchemy relationship target
from backend.models.user import User
from backend.services.alert_checker import AlertChecker


def _user(sla_enabled: bool) -> Mock:
    user = Mock(spec=User)
    user.id = 1
    user.email = "analyst@example.com"
    user.full_name = "Analyst"
    user.is_active = True
    user.auto_escalate_incidents = False
    user.sla_due_dates_enabled = sla_enabled
    user.sla_days_critical = 1
    user.sla_days_high = 3
    user.sla_days_medium = 7
    user.sla_days_low = 14
    user.sla_days_info = 30
    return user


def _asset() -> Mock:
    asset = Mock(spec=Asset)
    asset.id = 1
    asset.name = "edge-router"
    asset.asset_type = AssetType.HARDWARE
    return asset


def _db() -> AsyncMock:
    db = AsyncMock()
    db.add = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)
    return db


def _added_alert(db: AsyncMock):
    from backend.models.alert import Alert
    alerts = [call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], Alert)]
    assert len(alerts) == 1
    return alerts[0]


@pytest.mark.asyncio
@patch("backend.services.alert_checker.cve_enrichment_service.enrich_cve", new_callable=AsyncMock)
@patch("backend.services.alert_checker.email_service")
async def test_new_cve_alert_gets_sla_due_date(mock_email, mock_enrich):
    mock_enrich.return_value = {}
    checker = AlertChecker()
    db = _db()
    cve = {"cve_id": "CVE-2026-0001", "title": "Router RCE", "description": "rce",
           "severity": "high", "source_url": "https://example.com/cve"}
    await checker._create_alert_from_cve(db, _user(True), _asset(), cve)
    alert = _added_alert(db)
    assert alert.due_date == date.today() + timedelta(days=3)


@pytest.mark.asyncio
@patch("backend.services.alert_checker.cve_enrichment_service.enrich_cve", new_callable=AsyncMock)
@patch("backend.services.alert_checker.email_service")
async def test_sla_disabled_leaves_due_date_empty(mock_email, mock_enrich):
    mock_enrich.return_value = {}
    checker = AlertChecker()
    db = _db()
    cve = {"cve_id": "CVE-2026-0001", "title": "Router RCE", "description": "rce",
           "severity": "critical", "source_url": "https://example.com/cve"}
    await checker._create_alert_from_cve(db, _user(False), _asset(), cve)
    alert = _added_alert(db)
    assert alert.due_date is None


@pytest.mark.asyncio
@patch("backend.services.alert_checker.email_service")
async def test_new_advisory_alert_gets_sla_due_date(mock_email):
    checker = AlertChecker()
    db = _db()
    advisory = {"vendor_advisory_id": "cisco-sa-1", "title": "Cisco advisory",
                "description": "advisory", "severity": "medium",
                "source_url": "https://example.com/advisory"}
    await checker._create_alert_from_advisory(db, _user(True), _asset(), advisory)
    alert = _added_alert(db)
    assert alert.due_date == date.today() + timedelta(days=7)


@pytest.mark.asyncio
@patch("backend.services.alert_checker.email_service")
async def test_unknown_severity_gets_no_due_date(mock_email):
    checker = AlertChecker()
    db = _db()
    advisory = {"vendor_advisory_id": "cisco-sa-2", "title": "Cisco advisory",
                "description": "advisory", "severity": "unknown",
                "source_url": "https://example.com/advisory"}
    await checker._create_alert_from_advisory(db, _user(True), _asset(), advisory)
    alert = _added_alert(db)
    assert alert.due_date is None
