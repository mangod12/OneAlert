"""
Slack and Webhook notification services for alert delivery.
"""
import httpx
import logging

logger = logging.getLogger(__name__)

class SlackNotificationService:
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    async def send(self, message: str, **kwargs):
        if not self.webhook_url:
            logger.warning("Slack webhook URL not configured.")
            return
        payload = {"text": message}
        try:
            async with httpx.AsyncClient() as client:
                await client.post(self.webhook_url, json=payload)
        except Exception as e:
            logger.error(f"Slack notification failed: {e}")

class WebhookNotificationService:
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    async def send(self, message: str, **kwargs):
        if not self.webhook_url:
            logger.warning("Generic webhook URL not configured.")
            return
        payload = {"message": message, **kwargs}
        try:
            async with httpx.AsyncClient() as client:
                await client.post(self.webhook_url, json=payload)
        except Exception as e:
            logger.error(f"Webhook notification failed: {e}")
