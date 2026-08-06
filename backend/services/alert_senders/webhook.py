import requests
from .base import AlertSenderBase

class WebhookAlertSender(AlertSenderBase):
    def __init__(self, url: str):
        self.url = url

    def send_alert(self, alert):
        response = requests.post(self.url, json=alert, timeout=10, allow_redirects=False)
        response.raise_for_status()
