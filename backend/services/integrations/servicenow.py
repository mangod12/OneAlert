"""ServiceNow integration for incident creation."""
import logging

import httpx
from .base import BaseIntegration, INTEGRATION_REQUEST_ERROR, validate_outbound_url


logger = logging.getLogger(__name__)


class ServiceNowIntegration(BaseIntegration):
    """Create incidents in ServiceNow from critical alerts."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.name = "servicenow"
        self.instance_url = config.get("instance_url", "")
        self.username = config.get("username", "")
        self.password = config.get("password", "")

    async def send_alert(self, alert_data: dict) -> dict:
        if not self.instance_url or not self.username:
            return {"success": False, "error": "ServiceNow not configured"}

        incident = {
            "short_description": f"[OneAlert] {alert_data.get('title', 'Security Alert')}",
            "description": alert_data.get("description", ""),
            "urgency": "1" if alert_data.get("severity") == "critical" else "2",
            "impact": "1" if alert_data.get("severity") in ("critical", "high") else "2",
            "category": "Security",
        }

        try:
            base_url = self.instance_url.rstrip("/")
            url = await validate_outbound_url(f"{base_url}/api/now/table/incident")
            async with httpx.AsyncClient(
                timeout=10.0, verify=True, follow_redirects=False
            ) as client:
                response = await client.post(
                    url,
                    json=incident,
                    auth=(self.username, self.password),
                    headers={"Accept": "application/json"}
                )
                return {"success": response.status_code == 201, "status_code": response.status_code}
        except Exception:
            logger.exception("ServiceNow incident creation failed")
            return {"success": False, "error": INTEGRATION_REQUEST_ERROR}

    async def test_connection(self) -> dict:
        if not self.instance_url or not self.username:
            return {"success": False, "error": "ServiceNow not configured"}

        try:
            base_url = self.instance_url.rstrip("/")
            url = await validate_outbound_url(
                f"{base_url}/api/now/table/sys_user?sysparm_limit=1"
            )
            async with httpx.AsyncClient(
                timeout=10.0, verify=True, follow_redirects=False
            ) as client:
                response = await client.get(
                    url,
                    auth=(self.username, self.password),
                    headers={"Accept": "application/json"}
                )
                return {"success": response.status_code == 200}
        except Exception:
            logger.exception("ServiceNow connection test failed")
            return {"success": False, "error": INTEGRATION_REQUEST_ERROR}
