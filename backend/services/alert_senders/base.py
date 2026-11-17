import abc
from typing import Any


class AlertSenderBase(abc.ABC):
    @abc.abstractmethod
    def send_alert(self, alert: dict[str, Any]):
        """
        Send an alert to the configured destination.
        """
