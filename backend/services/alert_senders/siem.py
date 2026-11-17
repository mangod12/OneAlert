from backend.logging_config import logger

from .base import AlertSenderBase


class SIEMAlertSender(AlertSenderBase):
    def __init__(self, config: dict):
        self.config = config

    def send_alert(self, alert):
        # For demo, just log. Replace with real SIEM integration.
        logger.info(f"[SIEM] Would send alert: {alert}")
