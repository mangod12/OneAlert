"""Deliver investigation events to email and chat/webhook channels.

Case assignments, incident auto-escalations and SLA breaches land in-app
first; when the user's notification preferences allow (global toggle,
minimum severity, quiet hours, muted kinds) they also go out by email and
to the configured Slack/generic webhooks - the same endpoints alerts use.
"""

import asyncio
import logging
import os

from backend.models.user import User
from backend.services.email_alert import email_service
from backend.services.notification_prefs import should_email_event
from backend.services.slack_webhook import SlackNotificationService, WebhookNotificationService

logger = logging.getLogger(__name__)


async def notify_investigation_event(
    user: User,
    *,
    kind: str,
    severity: str | None,
    title: str,
    body: str,
    link_path: str | None = None,
) -> None:
    """Email + webhook an investigation event when the user's preferences allow it."""
    if not should_email_event(user, kind, severity):
        return
    await email_service.send_investigation_event(user, title=title, body=body, link_path=link_path)

    slack_url = getattr(user, "slack_webhook_url", None) or os.getenv("SLACK_WEBHOOK_URL")
    webhook_url = getattr(user, "webhook_url", None) or os.getenv("GENERIC_WEBHOOK_URL")
    if not slack_url and not webhook_url:
        return
    message = f"*{title}*\n{body}"
    if link_path:
        message += f"\nOpen in OneAlert: {link_path}"
    tasks = []
    if slack_url:
        tasks.append(SlackNotificationService(slack_url).send(message))
    if webhook_url:
        tasks.append(WebhookNotificationService(webhook_url).send(message, title=title, link=link_path))
    # return_exceptions: a broken webhook must not lose the in-app notification or the other channel
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for result in results:
        if isinstance(result, Exception):
            logger.warning(
                "Investigation event webhook delivery failed for user %s: %s",
                getattr(user, "email", "unknown"),
                result,
            )
