"""
Tests for Slack/webhook delivery of investigation events.

Case assignments, incident auto-escalations and SLA breaches post to the
configured Slack/generic webhooks alongside the email, honoring the same
preferences (muted kinds, disabled email, quiet hours below critical).
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest

from backend.models.case import Case  # noqa: F401  (pulls model deps for mappers)
from backend.models.user import User
from backend.services import investigation_notify
from backend.services.investigation_notify import notify_investigation_event


def make_user(**overrides) -> Mock:
    user = Mock(spec=User)
    user.email = "analyst@example.com"
    user.email_notifications_enabled = True
    user.notify_min_severity = "low"
    user.quiet_hours_start = None
    user.quiet_hours_end = None
    user.muted_kinds = []
    user.slack_webhook_url = None
    user.webhook_url = None
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


@pytest.fixture
def mock_email():
    with patch.object(
        investigation_notify.email_service, "send_investigation_event", new=AsyncMock(return_value=True)
    ) as mock:
        yield mock


@pytest.fixture
def mock_senders():
    with (
        patch.object(investigation_notify, "SlackNotificationService") as slack_cls,
        patch.object(investigation_notify, "WebhookNotificationService") as webhook_cls,
    ):
        slack_cls.return_value.send = AsyncMock()
        webhook_cls.return_value.send = AsyncMock()
        yield slack_cls, webhook_cls


@pytest.mark.asyncio
async def test_slack_receives_investigation_event(mock_email, mock_senders):
    slack_cls, _ = mock_senders
    user = make_user(slack_webhook_url="https://hooks.slack.com/services/abc")
    await notify_investigation_event(
        user,
        kind="case_assigned",
        severity="high",
        title="Case #12 assigned to you",
        body="sam@example.com assigned you an investigation.",
        link_path="/app/cases/12",
    )
    slack_cls.assert_called_once_with("https://hooks.slack.com/services/abc")
    message = slack_cls.return_value.send.await_args.args[0]
    assert "Case #12 assigned to you" in message
    assert "sam@example.com assigned you an investigation." in message
    assert "/app/cases/12" in message
    mock_email.assert_awaited_once()


@pytest.mark.asyncio
async def test_generic_webhook_receives_investigation_event(mock_email, mock_senders):
    _, webhook_cls = mock_senders
    user = make_user(webhook_url="https://security.example.com/hook")
    await notify_investigation_event(
        user,
        kind="case_sla_breached",
        severity="medium",
        title="Investigation overdue: Suspicious OAuth grant",
        body="Investigation #9 passed its SLA target.",
    )
    webhook_cls.assert_called_once_with("https://security.example.com/hook")
    webhook_cls.return_value.send.assert_awaited_once()


@pytest.mark.asyncio
async def test_muted_kind_suppresses_email_and_webhooks(mock_email, mock_senders):
    slack_cls, webhook_cls = mock_senders
    user = make_user(
        slack_webhook_url="https://hooks.slack.com/services/abc",
        webhook_url="https://security.example.com/hook",
        muted_kinds=["case_sla_breached"],
    )
    await notify_investigation_event(
        user, kind="case_sla_breached", severity="high", title="t", body="b"
    )
    mock_email.assert_not_awaited()
    slack_cls.assert_not_called()
    webhook_cls.assert_not_called()


@pytest.mark.asyncio
async def test_disabled_email_suppresses_webhooks_too(mock_email, mock_senders):
    slack_cls, _ = mock_senders
    user = make_user(
        slack_webhook_url="https://hooks.slack.com/services/abc",
        email_notifications_enabled=False,
    )
    await notify_investigation_event(
        user, kind="case_assigned", severity="critical", title="t", body="b"
    )
    mock_email.assert_not_awaited()
    slack_cls.assert_not_called()


@pytest.mark.asyncio
async def test_no_webhook_configured_skips_delivery(mock_email, mock_senders, monkeypatch):
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("GENERIC_WEBHOOK_URL", raising=False)
    slack_cls, webhook_cls = mock_senders
    await notify_investigation_event(
        make_user(), kind="case_assigned", severity="high", title="t", body="b"
    )
    mock_email.assert_awaited_once()
    slack_cls.assert_not_called()
    webhook_cls.assert_not_called()


@pytest.mark.asyncio
async def test_env_default_webhook_used_when_user_has_none(mock_email, mock_senders, monkeypatch):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/org")
    slack_cls, _ = mock_senders
    await notify_investigation_event(
        make_user(), kind="incident_escalated", severity="critical", title="t", body="b"
    )
    slack_cls.assert_called_once_with("https://hooks.slack.com/services/org")


@pytest.mark.asyncio
async def test_user_webhook_wins_over_env_default(mock_email, mock_senders, monkeypatch):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/org")
    slack_cls, _ = mock_senders
    user = make_user(slack_webhook_url="https://hooks.slack.com/services/personal")
    await notify_investigation_event(
        user, kind="incident_escalated", severity="critical", title="t", body="b"
    )
    slack_cls.assert_called_once_with("https://hooks.slack.com/services/personal")
