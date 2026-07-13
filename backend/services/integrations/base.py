"""Base class and security helpers for SIEM/SOAR integrations."""

import asyncio
import ipaddress
import socket
from abc import ABC, abstractmethod
from urllib.parse import urlsplit


INTEGRATION_REQUEST_ERROR = "Integration request failed"


async def validate_outbound_url(url: str) -> str:
    """Require HTTPS and reject endpoints resolving to non-public networks."""
    try:
        parsed = urlsplit(url)
        port = parsed.port or 443
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid integration URL") from exc

    if parsed.scheme.lower() != "https":
        raise ValueError("Integration URL must use HTTPS")
    if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Invalid integration URL")

    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            parsed.hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise ValueError("Integration hostname could not be resolved") from exc

    if not addresses:
        raise ValueError("Integration hostname could not be resolved")

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if (
            not ip.is_global
            or ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise ValueError("Integration hostname must resolve only to public addresses")

    return url


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
