"""AI model router — selects the right provider and model for each task type."""

import logging
import os
from functools import lru_cache

from backend.services.ai.provider import AIProvider
from backend.services.ai.anthropic_provider import AnthropicProvider
from backend.services.ai.openai_provider import OpenAICompatibleProvider

logger = logging.getLogger(__name__)


# Task types that the router can route to different models
TASK_TRIAGE = "triage"
TASK_CODE = "code"
TASK_SUMMARIZE = "summarize"
TASK_EMBED = "embed"
TASK_DETECT = "detect"
TASK_HUNT = "hunt"
TASK_DEFAULT = "default"


def _get_ai_settings() -> dict:
    """Read AI settings from environment."""
    return {
        "provider": os.getenv("AI_PROVIDER", "anthropic"),
        "base_url": os.getenv("AI_BASE_URL", ""),
        "api_key": os.getenv("AI_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", ""),
        "triage_model": os.getenv("AI_TRIAGE_MODEL", ""),
        "code_model": os.getenv("AI_CODE_MODEL", ""),
        "embed_model": os.getenv("AI_EMBEDDING_MODEL", ""),
        "default_model": os.getenv("AI_DEFAULT_MODEL", ""),
    }


# Default models per provider
PROVIDER_DEFAULTS = {
    "anthropic": {
        "default": "claude-sonnet-4-20250514",
        "triage": "claude-sonnet-4-20250514",
        "code": "claude-sonnet-4-20250514",
        "summarize": "claude-haiku-4-5-20251001",
        "detect": "claude-sonnet-4-20250514",
        "hunt": "claude-sonnet-4-20250514",
    },
    "openai": {
        "default": "gpt-4o",
        "triage": "gpt-4o",
        "code": "gpt-4o",
        "summarize": "gpt-4o-mini",
        "embed": "text-embedding-3-small",
        "detect": "gpt-4o",
        "hunt": "gpt-4o",
    },
    "ollama": {
        "default": "llama3.1:8b",
        "triage": "llama3.1:8b",
        "code": "qwen2.5-coder:14b",
        "summarize": "llama3.1:8b",
        "embed": "nomic-embed-text",
        "detect": "llama3.1:8b",
        "hunt": "llama3.1:8b",
    },
}


def _resolve_model(settings: dict, task: str) -> str:
    """Resolve model name for a given task."""
    provider = settings["provider"]

    # Check explicit env overrides first
    explicit_map = {
        TASK_TRIAGE: settings["triage_model"],
        TASK_CODE: settings["code_model"],
        TASK_EMBED: settings["embed_model"],
    }
    explicit = explicit_map.get(task) or settings["default_model"]
    if explicit:
        return explicit

    # Fall back to provider defaults
    defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["openai"])
    return defaults.get(task, defaults["default"])


def _build_provider(settings: dict, model: str) -> AIProvider:
    """Instantiate the correct provider class."""
    provider_name = settings["provider"]

    if provider_name == "anthropic":
        return AnthropicProvider(
            model=model,
            api_key=settings["api_key"],
        )

    # Everything else uses OpenAI-compatible
    base_url = settings["base_url"]
    if not base_url:
        url_map = {
            "openai": "https://api.openai.com/v1",
            "groq": "https://api.groq.com/openai/v1",
            "together": "https://api.together.xyz/v1",
            "ollama": "http://localhost:11434/v1",
            "vllm": "http://localhost:8000/v1",
            "llamacpp": "http://localhost:8080/v1",
        }
        base_url = url_map.get(provider_name, "http://localhost:11434/v1")

    return OpenAICompatibleProvider(
        model=model,
        base_url=base_url,
        api_key=settings["api_key"],
    )


def get_ai_provider(task: str = TASK_DEFAULT) -> AIProvider:
    """Get the AI provider configured for a specific task.

    Usage:
        provider = get_ai_provider("triage")
        response = await provider.complete([...])
    """
    settings = _get_ai_settings()
    model = _resolve_model(settings, task)
    return _build_provider(settings, model)


class AIRouter:
    """Convenience class for accessing task-specific AI providers."""

    def triage(self) -> AIProvider:
        return get_ai_provider(TASK_TRIAGE)

    def code(self) -> AIProvider:
        return get_ai_provider(TASK_CODE)

    def summarize(self) -> AIProvider:
        return get_ai_provider(TASK_SUMMARIZE)

    def embed(self) -> AIProvider:
        return get_ai_provider(TASK_EMBED)

    def detect(self) -> AIProvider:
        return get_ai_provider(TASK_DETECT)

    def hunt(self) -> AIProvider:
        return get_ai_provider(TASK_HUNT)

    def default(self) -> AIProvider:
        return get_ai_provider(TASK_DEFAULT)


# Global router instance
ai_router = AIRouter()
