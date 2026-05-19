"""Abstract base for AI providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AIResponse:
    """Standardized response from any AI provider."""
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    metadata: dict = field(default_factory=dict)


@dataclass
class AIMessage:
    """Chat message for AI providers."""
    role: str  # "system", "user", "assistant"
    content: str


class AIProvider(ABC):
    """Abstract base class for AI providers."""

    def __init__(self, model: str, base_url: str | None = None, api_key: str | None = None):
        self.model = model
        self.base_url = base_url
        self.api_key = api_key

    @abstractmethod
    async def complete(
        self,
        messages: list[AIMessage],
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AIResponse:
        """Generate a text completion from messages."""

    async def complete_json(
        self,
        messages: list[AIMessage],
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        """Generate a JSON completion. Wraps complete() with JSON parsing."""
        import json

        system_suffix = "\n\nRespond with valid JSON only. No markdown, no explanation."
        if messages and messages[0].role == "system":
            messages = [
                AIMessage(role="system", content=messages[0].content + system_suffix),
                *messages[1:],
            ]
        else:
            messages = [AIMessage(role="system", content=system_suffix.strip()), *messages]

        response = await self.complete(messages, temperature=temperature, max_tokens=max_tokens)
        text = response.content.strip()

        # Strip markdown code fences if present
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(lines)

        return json.loads(text)

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a list of texts."""

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(model={self.model!r})"
