"""Base agent with run/step ledger logging."""

import logging
import time
from datetime import datetime, timezone
from abc import ABC, abstractmethod

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.case import AgentRun, AgentStep

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Abstract base for all OneAlert AI agents."""

    agent_type: str = "base"

    def __init__(self, db: AsyncSession, user_id: int):
        self.db = db
        self.user_id = user_id
        self._run: AgentRun | None = None
        self._step_count = 0
        self._total_prompt_tokens = 0
        self._total_completion_tokens = 0

    async def execute(self, **kwargs) -> dict:
        """Execute the agent with full ledger logging."""
        self._run = AgentRun(
            user_id=self.user_id,
            agent_type=self.agent_type,
            status="running",
        )
        self.db.add(self._run)
        await self.db.flush()

        try:
            result = await self.run(**kwargs)
            self._run.status = "completed"
            self._run.completed_at = datetime.now(timezone.utc)
            self._run.result_summary = str(result.get("summary", ""))[:500]
            self._run.prompt_tokens = self._total_prompt_tokens
            self._run.completion_tokens = self._total_completion_tokens
            await self.db.commit()
            return result
        except Exception as e:
            self._run.status = "failed"
            self._run.completed_at = datetime.now(timezone.utc)
            self._run.error_message = str(e)[:500]
            await self.db.commit()
            logger.error(f"Agent {self.agent_type} failed: {e}")
            raise

    async def log_step(self, action: str, input_summary: str = "", output_summary: str = "", tool_used: str = "", duration_ms: int = 0):
        """Log a step in the agent run ledger."""
        if not self._run:
            return
        self._step_count += 1
        step = AgentStep(
            run_id=self._run.id,
            step_number=self._step_count,
            action=action,
            input_summary=input_summary[:500] if input_summary else "",
            output_summary=output_summary[:500] if output_summary else "",
            tool_used=tool_used,
            duration_ms=duration_ms,
        )
        self.db.add(step)
        await self.db.flush()

    def track_tokens(self, prompt: int, completion: int):
        """Track token usage across LLM calls."""
        self._total_prompt_tokens += prompt
        self._total_completion_tokens += completion
        if self._run:
            self._run.model_used = getattr(self, '_last_model', None)

    @abstractmethod
    async def run(self, **kwargs) -> dict:
        """Implement agent-specific logic. Must return a result dict."""
