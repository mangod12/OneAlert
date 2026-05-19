"""Anthropic Claude AI provider."""

import httpx
import logging

from backend.services.ai.provider import AIProvider, AIMessage, AIResponse

logger = logging.getLogger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider(AIProvider):
    """AI provider using Anthropic's Claude API."""

    async def complete(
        self,
        messages: list[AIMessage],
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AIResponse:
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for Anthropic provider")

        # Anthropic requires system message separate from messages
        system_text = ""
        chat_messages = []
        for msg in messages:
            if msg.role == "system":
                system_text += msg.content + "\n"
            else:
                chat_messages.append({"role": msg.role, "content": msg.content})

        # Ensure at least one user message
        if not chat_messages:
            raise ValueError("At least one non-system message is required")

        payload: dict = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": chat_messages,
        }
        if system_text.strip():
            payload["system"] = system_text.strip()

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(ANTHROPIC_API_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        content = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                content += block["text"]

        usage = data.get("usage", {})
        return AIResponse(
            content=content,
            model=data.get("model", self.model),
            prompt_tokens=usage.get("input_tokens", 0),
            completion_tokens=usage.get("output_tokens", 0),
            total_tokens=usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError("Anthropic does not provide an embeddings API. Use a different provider for embeddings.")
