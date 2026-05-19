"""AI provider abstraction layer for OneAlert AI Security OS."""

from backend.services.ai.router import ai_router, get_ai_provider

__all__ = ["ai_router", "get_ai_provider"]
