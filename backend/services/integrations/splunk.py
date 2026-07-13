"""Splunk HTTP Event Collector integration."""
import logging

import httpx
from .base import BaseIntegration, INTEGRATION_REQUEST_ERROR, validate_outbound_url


logger = logging.getLogger(__name__)


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
            base_url = self.hec_url.rstrip("/")
            url = await validate_outbound_url(f"{base_url}/services/collector/event")
            async with httpx.AsyncClient(
                timeout=10.0, verify=True, follow_redirects=False
            ) as client:
                response = await client.post(
                    url,
                    json=event,
                    headers={"Authorization": f"Splunk {self.hec_token}"}
                )
                return {"success": response.status_code == 200, "status_code": response.status_code}
        except Exception:
            logger.exception("Splunk alert delivery failed")
            return {"success": False, "error": INTEGRATION_REQUEST_ERROR}

    async def test_connection(self) -> dict:
        if not self.hec_url or not self.hec_token:
            return {"success": False, "error": "Splunk HEC not configured"}

        try:
            base_url = self.hec_url.rstrip("/")
            url = await validate_outbound_url(f"{base_url}/services/collector/health")
            async with httpx.AsyncClient(
                timeout=10.0, verify=True, follow_redirects=False
            ) as client:
                response = await client.get(
                    url,
                    headers={"Authorization": f"Splunk {self.hec_token}"}
                )
                return {"success": response.status_code == 200}
        except Exception:
            logger.exception("Splunk connection test failed")
            return {"success": False, "error": INTEGRATION_REQUEST_ERROR}
