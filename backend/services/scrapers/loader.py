import asyncio
import importlib
import os
import pkgutil
from typing import Any

from backend.logging_config import logger

from .base import ScraperBase

SCRAPER_PACKAGE = __package__

async def run_all_scrapers() -> list[dict[str, Any]]:
    """
    Dynamically load and run all scrapers in this package asynchronously.
    Returns a list of all found vulnerabilities.
    """
    scrapers = []
    results = []
    for _, module_name, is_pkg in pkgutil.iter_modules([os.path.dirname(__file__)]):
        if is_pkg or module_name in ("base", "loader"):
            continue
        module = importlib.import_module(f"{SCRAPER_PACKAGE}.{module_name}")
        for attr in dir(module):
            obj = getattr(module, attr)
            if isinstance(obj, type) and issubclass(obj, ScraperBase) and obj is not ScraperBase:
                scrapers.append(obj())
    logger.info(f"Loaded scrapers: {[s.name for s in scrapers]}")
    tasks = [s.scrape() for s in scrapers]
    results_nested = await asyncio.gather(*tasks, return_exceptions=True)
    for scraper, result in zip(scrapers, results_nested):
        if isinstance(result, Exception):
            logger.error(f"Error in scraper {scraper.name}: {result}")
        else:
            logger.info(f"{scraper.name} found {len(result)} vulnerabilities.")
            results.extend(result)
    return results
