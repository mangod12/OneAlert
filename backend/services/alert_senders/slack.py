import requests
from .base import AlertSenderBase

class SlackAlertSender(AlertSenderBase):
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    def send_alert(self, alert):
        message = f"*{alert['title']}* ({alert['cve_id']})\n<{alert['url']}|View Details>"
        payload = {"text": message}
        response = requests.post(self.webhook_url, json=payload, timeout=10, allow_redirects=False)
        response.raise_for_status()
