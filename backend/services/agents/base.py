"""Base agent with run/step ledger logging."""

import json
import logging
from abc import ABC, abstractmethod
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.case import AgentRun, AgentStep
from backend.services.ai.usage import completion_observer

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
        self._step_count = 0
        self._total_prompt_tokens = 0
        self._total_completion_tokens = 0
        self._run = AgentRun(
            user_id=self.user_id,
            agent_type=self.agent_type,
            status="running",
        )
        self.db.add(self._run)
        await self.db.flush()

        observation = completion_observer.set(self._record_completion_usage)
        try:
            result = await self.run(**kwargs)
            outcome = result.get("status")
            self._run.status = ("failed" if result.get("error")
                                else outcome if outcome in ("partial", "failed", "cancelled") else "completed")
            if result.get("error"):
                self._run.error_message = str(result["error"])[:500]
            self._run.completed_at = datetime.now(UTC)
            self._run.result_summary = str(result.get("summary", ""))[:500]
            self._run.prompt_tokens = self._total_prompt_tokens
            self._run.completion_tokens = self._total_completion_tokens
            await self.db.commit()
            return result
        except Exception as e:
            self._run.status = "failed"
            self._run.completed_at = datetime.now(UTC)
            self._run.error_message = str(e)[:500]
            self._run.prompt_tokens = self._total_prompt_tokens
            self._run.completion_tokens = self._total_completion_tokens
            await self.db.commit()
            logger.error(f"Agent {self.agent_type} failed: {e}")
            raise
        finally:
            completion_observer.reset(observation)

    async def _record_completion_usage(self, response):
        states = response.metadata.get("usage_states", {}) if isinstance(response.metadata, dict) else {}
        if not isinstance(states, dict):
            states = {}
        receipt = {"format": "onealert-provider-usage-v1", "prompt": None, "completion": None,
                   "prompt_state": "missing", "completion_state": "missing"}
        for key in ("prompt", "completion"):
            value = getattr(response, key + "_tokens", None)
            state = states.get(key, "missing")
            if state == "reported" and type(value) is int and 0 <= value <= 2**31 - 1:
                total = getattr(self, "_total_" + key + "_tokens") + value
                if total <= 2**31 - 1:
                    setattr(self, "_total_" + key + "_tokens", total)
                    receipt[key] = value
                else:
                    state = "invalid"
            elif state != "missing":
                state = "invalid"
            receipt[key + "_state"] = state
        if self._run is not None and isinstance(response.model, str) and response.model:
            self._run.model_used = response.model
        await self.log_step("provider_usage_receipt", output_summary=json.dumps(receipt, separators=(",", ":")),
                            tool_used="ai_provider")

    async def log_step(
        self, action: str, input_summary: str = "", output_summary: str = "",
        tool_used: str = "", duration_ms: int = 0,
    ):
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
