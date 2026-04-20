"""Splunk HTTP Event Collector integration."""
import httpx
from .base import BaseIntegration


class SplunkIntegration(BaseIntegration):
    """Send alerts to Splunk via HTTP Event Collector."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.name = "splunk"
        self.hec_url = config.get("hec_url", "")
        self.hec_token = config.get("hec_token", "")
        self.index = config.get("index", "main")
        self.source_type = config.get("source_type", "onealert:vulnerability")

    async def send_alert(self, alert_data: dict) -> dict:
        if not self.hec_url or not self.hec_token:
            return {"success": False, "error": "Splunk HEC not configured"}

        event = {
            "event": alert_data,
            "sourcetype": self.source_type,
            "index": self.index,
            "source": "onealert",
        }

        try:
            # verify=False used for dev convenience with self-signed certs
            async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
                response = await client.post(
                    f"{self.hec_url}/services/collector/event",
                    json=event,
                    headers={"Authorization": f"Splunk {self.hec_token}"}
                )
                return {"success": response.status_code == 200, "status_code": response.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def test_connection(self) -> dict:
        if not self.hec_url or not self.hec_token:
            return {"success": False, "error": "Splunk HEC not configured"}

        try:
            # verify=False used for dev convenience with self-signed certs
            async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
                response = await client.get(
                    f"{self.hec_url}/services/collector/health",
                    headers={"Authorization": f"Splunk {self.hec_token}"}
                )
                return {"success": response.status_code == 200}
        except Exception as e:
            return {"success": False, "error": str(e)}
