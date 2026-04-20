"""Microsoft Sentinel integration via Log Analytics Data Collector API."""
import httpx
import json
import hashlib
import hmac
import base64
from datetime import datetime, timezone
from .base import BaseIntegration


class SentinelIntegration(BaseIntegration):
    """Send alerts to Microsoft Sentinel."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.name = "sentinel"
        self.workspace_id = config.get("workspace_id", "")
        self.shared_key = config.get("shared_key", "")
        self.log_type = config.get("log_type", "OneAlert_Vulnerability")

    def _build_signature(self, date: str, content_length: int) -> str:
        """Build authorization signature for Log Analytics API."""
        string_to_hash = f"POST\n{content_length}\napplication/json\nx-ms-date:{date}\n/api/logs"
        bytes_to_hash = string_to_hash.encode("utf-8")
        decoded_key = base64.b64decode(self.shared_key)
        encoded_hash = base64.b64encode(
            hmac.new(decoded_key, bytes_to_hash, digestmod=hashlib.sha256).digest()
        ).decode("utf-8")
        return f"SharedKey {self.workspace_id}:{encoded_hash}"

    async def send_alert(self, alert_data: dict) -> dict:
        if not self.workspace_id or not self.shared_key:
            return {"success": False, "error": "Sentinel not configured"}

        body = json.dumps([alert_data])
        rfc1123_date = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")

        try:
            signature = self._build_signature(rfc1123_date, len(body))
            url = f"https://{self.workspace_id}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": signature,
                        "Log-Type": self.log_type,
                        "x-ms-date": rfc1123_date,
                    }
                )
                return {"success": response.status_code in (200, 202), "status_code": response.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def test_connection(self) -> dict:
        if not self.workspace_id or not self.shared_key:
            return {"success": False, "error": "Sentinel not configured"}
        return {"success": True, "message": "Credentials configured (test requires sending data)"}
