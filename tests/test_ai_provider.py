"""Tests for AI provider abstraction layer."""
import pytest
from urllib.parse import urlparse
import json
from unittest.mock import AsyncMock, patch, MagicMock

from backend.services.ai.provider import AIProvider, AIMessage, AIResponse
from backend.services.ai.anthropic_provider import AnthropicProvider
from backend.services.ai.openai_provider import OpenAICompatibleProvider
from backend.services.ai.router import (
    get_ai_provider, ai_router, _resolve_model, _get_ai_settings,
    TASK_TRIAGE, TASK_CODE, TASK_SUMMARIZE, TASK_EMBED, TASK_DEFAULT,
)


class TestAIMessage:
    def test_create_message(self):
        msg = AIMessage(role="user", content="hello")
        assert msg.role == "user"
        assert msg.content == "hello"


class TestAIResponse:
    def test_create_response(self):
        resp = AIResponse(content="hi", model="test", prompt_tokens=10, completion_tokens=5, total_tokens=15)
        assert resp.content == "hi"
        assert resp.total_tokens == 15

    def test_defaults(self):
        resp = AIResponse(content="x", model="m")
        assert resp.prompt_tokens == 0
        assert resp.metadata == {}


class TestAnthropicProvider:
    def test_init(self):
        p = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="sk-test")
        assert p.model == "claude-sonnet-4-20250514"
        assert repr(p) == "AnthropicProvider(model='claude-sonnet-4-20250514')"

    @pytest.mark.asyncio
    async def test_complete_no_key_raises(self):
        p = AnthropicProvider(model="test")
        with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
            await p.complete([AIMessage(role="user", content="hi")])

    @pytest.mark.asyncio
    async def test_complete_no_user_message_raises(self):
        p = AnthropicProvider(model="test", api_key="sk-test")
        with pytest.raises(ValueError, match="non-system"):
            await p.complete([AIMessage(role="system", content="sys")])

    @pytest.mark.asyncio
    async def test_complete_success(self):
        p = AnthropicProvider(model="claude-test", api_key="sk-test")
        mock_response = {
            "content": [{"type": "text", "text": "Hello world"}],
            "model": "claude-test",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = mock_response
            mock_resp.raise_for_status = MagicMock()
            mock_post.return_value = mock_resp

            result = await p.complete([
                AIMessage(role="system", content="Be helpful"),
                AIMessage(role="user", content="Hi"),
            ])

        assert result.content == "Hello world"
        assert result.prompt_tokens == 10
        assert result.completion_tokens == 5

    @pytest.mark.asyncio
    async def test_embed_not_implemented(self):
        p = AnthropicProvider(model="test", api_key="sk-test")
        with pytest.raises(NotImplementedError):
            await p.embed(["text"])


class TestOpenAIProvider:
    def test_init_default_url(self):
        p = OpenAICompatibleProvider(model="gpt-4o")
        parsed = urlparse(p.base_url)
        assert parsed.scheme == "https"
        assert parsed.hostname == "api.openai.com"

    def test_init_custom_url(self):
        p = OpenAICompatibleProvider(model="llama", base_url="http://localhost:11434/v1")
        assert p.base_url == "http://localhost:11434/v1"

    @pytest.mark.asyncio
    async def test_complete_success(self):
        p = OpenAICompatibleProvider(model="gpt-4o", api_key="sk-test")
        mock_response = {
            "choices": [{"message": {"content": "Response"}}],
            "model": "gpt-4o",
            "usage": {"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = mock_response
            mock_resp.raise_for_status = MagicMock()
            mock_post.return_value = mock_resp

            result = await p.complete([AIMessage(role="user", content="Hi")])

        assert result.content == "Response"
        assert result.total_tokens == 11

    @pytest.mark.asyncio
    async def test_embed_success(self):
        p = OpenAICompatibleProvider(model="text-embedding-3-small", api_key="sk-test")
        mock_response = {
            "data": [{"embedding": [0.1, 0.2, 0.3]}],
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = mock_response
            mock_resp.raise_for_status = MagicMock()
            mock_post.return_value = mock_resp

            result = await p.embed(["hello"])

        assert result == [[0.1, 0.2, 0.3]]


class TestCompleteJSON:
    @pytest.mark.asyncio
    async def test_complete_json_parses(self):
        p = OpenAICompatibleProvider(model="gpt-4o", api_key="sk-test")
        mock_response = {
            "choices": [{"message": {"content": '{"key": "value"}'}}],
            "model": "gpt-4o",
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = mock_response
            mock_resp.raise_for_status = MagicMock()
            mock_post.return_value = mock_resp

            result = await p.complete_json([AIMessage(role="user", content="give json")])

        assert result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_complete_json_strips_markdown(self):
        p = OpenAICompatibleProvider(model="gpt-4o", api_key="sk-test")
        mock_response = {
            "choices": [{"message": {"content": '```json\n{"a": 1}\n```'}}],
            "model": "gpt-4o",
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = mock_response
            mock_resp.raise_for_status = MagicMock()
            mock_post.return_value = mock_resp

            result = await p.complete_json([AIMessage(role="user", content="give json")])

        assert result == {"a": 1}


class TestAIRouter:
    @patch.dict("os.environ", {"AI_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "sk-test"})
    def test_get_provider_anthropic(self):
        p = get_ai_provider(TASK_TRIAGE)
        assert isinstance(p, AnthropicProvider)

    @patch.dict("os.environ", {"AI_PROVIDER": "openai", "AI_API_KEY": "sk-test"})
    def test_get_provider_openai(self):
        p = get_ai_provider(TASK_TRIAGE)
        assert isinstance(p, OpenAICompatibleProvider)

    @patch.dict("os.environ", {"AI_PROVIDER": "ollama"})
    def test_get_provider_ollama(self):
        p = get_ai_provider(TASK_CODE)
        assert isinstance(p, OpenAICompatibleProvider)
        assert "localhost" in p.base_url

    @patch.dict("os.environ", {"AI_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "sk-test"})
    def test_router_methods(self):
        assert isinstance(ai_router.triage(), AnthropicProvider)
        assert isinstance(ai_router.code(), AnthropicProvider)
        assert isinstance(ai_router.summarize(), AnthropicProvider)
        assert isinstance(ai_router.default(), AnthropicProvider)

    @patch.dict("os.environ", {"AI_PROVIDER": "anthropic", "AI_TRIAGE_MODEL": "claude-custom"})
    def test_explicit_model_override(self):
        settings = _get_ai_settings()
        model = _resolve_model(settings, TASK_TRIAGE)
        assert model == "claude-custom"

    @patch.dict("os.environ", {"AI_PROVIDER": "openai"})
    def test_default_model_resolution(self):
        settings = _get_ai_settings()
        model = _resolve_model(settings, TASK_SUMMARIZE)
        assert model == "gpt-4o-mini"
