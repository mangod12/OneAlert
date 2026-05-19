"""Agent Orchestrator — runs the full detection → triage → case pipeline."""

import logging
import time
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.services.agents.detect import DetectAgent
from backend.services.agents.triage import TriageAgent

logger = logging.getLogger(__name__)


async def run_pipeline(db: AsyncSession, user_id: int, hours_back: int = 24) -> dict:
    """Execute the full agent pipeline: Detect → Triage.

    Returns combined results from both agents.
    """
    start = time.time()
    results = {
        "detect": None,
        "triage": None,
        "total_duration_ms": 0,
        "pipeline_status": "running",
    }

    # Stage 1: Detect Agent
    try:
        detect_agent = DetectAgent(db=db, user_id=user_id)
        results["detect"] = await detect_agent.execute(hours_back=hours_back)
        logger.info(f"Detect agent: {results['detect'].get('summary', '')}")
    except Exception as e:
        logger.error(f"Detect agent failed: {e}")
        results["detect"] = {"error": str(e)}

    # Stage 2: Triage Agent
    try:
        triage_agent = TriageAgent(db=db, user_id=user_id)
        results["triage"] = await triage_agent.execute(hours_back=hours_back)
        logger.info(f"Triage agent: {results['triage'].get('summary', '')}")
    except Exception as e:
        logger.error(f"Triage agent failed: {e}")
        results["triage"] = {"error": str(e)}

    results["total_duration_ms"] = int((time.time() - start) * 1000)
    results["pipeline_status"] = "completed"

    return results
