import abc
from typing import Any


class ScraperBase(abc.ABC):
    """
    Abstract base class for all OEM vulnerability scrapers.
    """
    name: str  # OEM name
    description: str  # Short description

    @abc.abstractmethod
    async def scrape(self) -> list[dict[str, Any]]:
        """
        Scrape for new vulnerabilities.
        Returns a list of dicts with at least 'cve_id', 'title', 'url', 'published_date'.
        """
