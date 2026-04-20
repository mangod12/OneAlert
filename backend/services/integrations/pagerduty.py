"""PagerDuty integration for incident triggering."""
import httpx
from .base import BaseIntegration


class PagerDutyIntegration(BaseIntegration):
    """Trigger PagerDuty incidents from critical alerts."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.name = "pagerduty"
        self.routing_key = config.get("routing_key", "")

    async def send_alert(self, alert_data: dict) -> dict:
        if not self.routing_key:
            return {"success": False, "error": "PagerDuty not configured"}

        severity_map = {"critical": "critical", "high": "error", "medium": "warning", "low": "info"}

        event = {
            "routing_key": self.routing_key,
            "event_action": "trigger",
            "payload": {
                "summary": f"[OneAlert] {alert_data.get('title', 'Security Alert')}",
                "severity": severity_map.get(alert_data.get("severity", "medium"), "warning"),
                "source": "OneAlert",
                "component": alert_data.get("asset_name", "Unknown"),
                "custom_details": alert_data,
            }
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://events.pagerduty.com/v2/enqueue",
                    json=event
                )
                return {"success": response.status_code == 202, "status_code": response.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def test_connection(self) -> dict:
        if not self.routing_key:
            return {"success": False, "error": "PagerDuty routing key not configured"}
        return {"success": True, "message": "Routing key configured"}
