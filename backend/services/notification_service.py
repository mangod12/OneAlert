"""
Notification service interface and implementations for Slack, Teams, Webhook, and SIEM.
Includes factory and unified notification dispatch for extensibility and Celery compatibility.
"""
import httpx
import logging
from typing import List
import os

logger = logging.getLogger(__name__)

class NotificationService:
    """Abstract base class for notification services."""
    async def send(self, message: str, **kwargs):
        raise NotImplementedError
    def send_sync(self, message: str, **kwargs):
        """Synchronous send for Celery tasks."""
        import asyncio
        try:
            asyncio.run(self.send(message, **kwargs))
        except Exception as e:
            logger.error(f"Synchronous notification failed: {e}")

class SlackNotificationService(NotificationService):
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
    async def send(self, message: str, **kwargs):
        payload = {"text": message}
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(self.webhook_url, json=payload)
                resp.raise_for_status()
            except Exception as e:
                logger.error(f"Slack notification failed: {e}")

class TeamsNotificationService(NotificationService):
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
    async def send(self, message: str, **kwargs):
        payload = {"text": message}
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(self.webhook_url, json=payload)
                resp.raise_for_status()
            except Exception as e:
                logger.error(f"Teams notification failed: {e}")

class WebhookNotificationService(NotificationService):
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
    async def send(self, message: str, **kwargs):
        payload = {"message": message, **kwargs}
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(self.webhook_url, json=payload)
                resp.raise_for_status()
            except Exception as e:
                logger.error(f"Webhook notification failed: {e}")

class SIEMNotificationService(NotificationService):
    def __init__(self, hec_url: str, hec_token: str):
        self.hec_url = hec_url
        self.hec_token = hec_token
    async def send(self, message: str, **kwargs):
        payload = {"event": message, **kwargs}
        headers = {"Authorization": f"Splunk {self.hec_token}"}
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(self.hec_url, json=payload, headers=headers)
                resp.raise_for_status()
            except Exception as e:
                logger.error(f"SIEM notification failed: {e}")

def get_notification_services_from_env() -> List[NotificationService]:
    """Factory to instantiate enabled notification services from environment variables."""
    services = []
    slack_url = os.getenv("SLACK_WEBHOOK_URL")
    if slack_url:
        services.append(SlackNotificationService(slack_url))
    teams_url = os.getenv("TEAMS_WEBHOOK_URL")
    if teams_url:
        services.append(TeamsNotificationService(teams_url))
    webhook_url = os.getenv("GENERIC_WEBHOOK_URL")
    if webhook_url:
        services.append(WebhookNotificationService(webhook_url))
    siem_url = os.getenv("SIEM_HEC_URL")
    siem_token = os.getenv("SIEM_HEC_TOKEN")
    if siem_url and siem_token:
        services.append(SIEMNotificationService(siem_url, siem_token))
    return services

def notify_all_services(message: str, **kwargs):
    """Send a notification to all enabled services asynchronously."""
    import asyncio
    services = get_notification_services_from_env()
    async def _notify():
        await asyncio.gather(*(svc.send(message, **kwargs) for svc in services))
    try:
        asyncio.run(_notify())
    except Exception as e:
        logger.error(f"notify_all_services failed: {e}")

# --- Advanced Notification Service: Ready for Integration ---
# This module provides async and sync notification dispatch, a factory for service instantiation,
# and a unified notify_all_services function for alerting via Slack, Teams, Webhook, and SIEM.
#
# Usage:
#   notify_all_services("Alert message", extra_key="extra_value")
#   # For Celery: service.send_sync(message)
#
# Environment variables:
#   SLACK_WEBHOOK_URL, TEAMS_WEBHOOK_URL, GENERIC_WEBHOOK_URL, SIEM_HEC_URL, SIEM_HEC_TOKEN
#
# Extend by adding new NotificationService subclasses and updating get_notification_services_from_env().
