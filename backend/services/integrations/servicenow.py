"""ServiceNow integration for incident creation."""
import httpx
from .base import BaseIntegration


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
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.instance_url}/api/now/table/incident",
                    json=incident,
                    auth=(self.username, self.password),
                    headers={"Accept": "application/json"}
                )
                return {"success": response.status_code == 201, "status_code": response.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def test_connection(self) -> dict:
        if not self.instance_url or not self.username:
            return {"success": False, "error": "ServiceNow not configured"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.instance_url}/api/now/table/sys_user?sysparm_limit=1",
                    auth=(self.username, self.password),
                    headers={"Accept": "application/json"}
                )
                return {"success": response.status_code == 200}
        except Exception as e:
            return {"success": False, "error": str(e)}
