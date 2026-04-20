"""Base class for SIEM/SOAR integrations."""
from abc import ABC, abstractmethod


class BaseIntegration(ABC):
    """Base class for all integrations."""

    def __init__(self, config: dict):
        self.config = config
        self.name: str = "base"

    @abstractmethod
    async def send_alert(self, alert_data: dict) -> dict:
        """Send an alert to the integration."""
        pass

    @abstractmethod
    async def test_connection(self) -> dict:
        """Test the integration connection."""
        pass
