"""Provider counter capture has task-local scope and survives invalid JSON or agent failure."""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from test_agent_run_detail import ledger  # noqa: F401

from backend.main import app
from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage, AIProvider, AIResponse
from backend.services.ai.usage import completion_observer, reported_usage


class Provider(AIProvider):
    async def complete(self, messages, **kwargs):
        await asyncio.sleep(0)
        return self.response

    async def embed(self, texts):
        return []


class Agent(BaseAgent):
    agent_type = 'test_usage'

    async def run(self, **kwargs):
        for response in kwargs['responses']:
            provider = Provider('configured-model')
            provider.response = response
            try:
                await provider.complete_json([AIMessage(role='user', content='private prompt')])
            except json.JSONDecodeError:
                if not kwargs.get('fallback'):
                    raise
        if kwargs.get('fail'):
            raise ValueError('later failure')
        return {'summary': 'recorded result'}


def make_agent(owner=1):
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    return Agent(db, owner)


def response(prompt=10, completion=4, text='{}', states=None):
    return AIResponse(text, 'returned-model', prompt_tokens=prompt, completion_tokens=completion,
                      metadata={'usage_states': states or {'prompt': 'reported', 'completion': 'reported'}})


def receipts(agent):
    return [json.loads(call.args[0].output_summary) for call in agent.db.add.call_args_list
            if getattr(call.args[0], 'action', None) == 'provider_usage_receipt']


@pytest.mark.asyncio
async def test_sums_each_returned_completion_once_records_model_and_no_content():
    agent = make_agent()
    await agent.execute(responses=[response(10, 4), response(5, 0)])
    assert agent._run.prompt_tokens == 15 and agent._run.completion_tokens == 4
    assert agent._run.model_used == 'returned-model'
    items = receipts(agent)
    assert len(items) == 2 and items[1]['completion'] == 0
    assert all(len(json.dumps(item)) < 500 for item in items)
    assert 'private prompt' not in json.dumps(items) and 'recorded result' not in json.dumps(items)
    assert completion_observer.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize('fallback', [False, True])
async def test_invalid_json_response_still_has_usage_evidence(fallback):
    agent = make_agent()
    if fallback:
        await agent.execute(responses=[response(text='not JSON')], fallback=True)
        assert agent._run.status == 'completed'
    else:
        with pytest.raises(json.JSONDecodeError):
            await agent.execute(responses=[response(text='not JSON')])
        assert agent._run.status == 'failed'
    assert agent._run.prompt_tokens == 10 and len(receipts(agent)) == 1
    assert completion_observer.get() is None


@pytest.mark.asyncio
async def test_later_agent_failure_preserves_returned_usage():
    agent = make_agent()
    with pytest.raises(ValueError):
        await agent.execute(responses=[response()], fail=True)
    assert agent._run.prompt_tokens == 10 and agent._run.completion_tokens == 4
    assert agent._run.status == 'failed'


@pytest.mark.asyncio
async def test_concurrent_owners_do_not_share_counters_or_receipts():
    first, second = make_agent(1), make_agent(2)
    await asyncio.gather(first.execute(responses=[response(2, 3), response(5, 7)]),
                         second.execute(responses=[response(11, 13)]))
    assert (first._run.prompt_tokens, first._run.completion_tokens) == (7, 10)
    assert (second._run.prompt_tokens, second._run.completion_tokens) == (11, 13)
    assert len(receipts(first)) == 2 and len(receipts(second)) == 1


@pytest.mark.asyncio
async def test_reused_agent_starts_new_counters_and_step_numbers():
    agent = make_agent()
    await agent.execute(responses=[response(10, 4)])
    await agent.execute(responses=[response(2, 0)])
    assert agent._run.prompt_tokens == 2 and agent._run.completion_tokens == 0 and agent._step_count == 1


@pytest.mark.asyncio
async def test_no_response_no_receipt_and_previous_observer_restored():
    previous = AsyncMock()
    token = completion_observer.set(previous)
    try:
        agent = make_agent()
        await agent.execute(responses=[])
        assert not receipts(agent) and agent._run.prompt_tokens == 0
        assert completion_observer.get() is previous
        previous.assert_not_awaited()
    finally:
        completion_observer.reset(token)


@pytest.mark.asyncio
async def test_unknown_and_invalid_counters_are_not_zero_receipts():
    agent = make_agent()
    await agent.execute(responses=[response(0, 0, states={'prompt': 'missing', 'completion': 'invalid'})])
    assert receipts(agent) == [{'format': 'onealert-provider-usage-v1', 'prompt': None, 'completion': None,
                               'prompt_state': 'missing', 'completion_state': 'invalid'}]


@pytest.mark.asyncio
async def test_counter_and_aggregate_overflow_fail_closed_without_failing_agent():
    agent = make_agent()
    await agent.execute(responses=[response(2147483647, 0), response(1, True)])
    assert agent._run.prompt_tokens == 2147483647 and agent._run.completion_tokens == 0
    assert receipts(agent)[1]['prompt_state'] == receipts(agent)[1]['completion_state'] == 'invalid'


@pytest.mark.parametrize(('usage', 'expected'), [
    (None, (0, 0, {'prompt': 'missing', 'completion': 'missing'})),
    ({}, (0, 0, {'prompt': 'missing', 'completion': 'missing'})),
    ({'prompt_tokens': 0, 'completion_tokens': 3}, (0, 3, {'prompt': 'reported', 'completion': 'reported'})),
    ({'prompt_tokens': '3', 'completion_tokens': -1}, (0, 0, {'prompt': 'invalid', 'completion': 'invalid'})),
    ({'prompt_tokens': True, 'completion_tokens': 1.5}, (0, 0, {'prompt': 'invalid', 'completion': 'invalid'})),
    ({'prompt_tokens': 2**40, 'completion_tokens': None}, (0, 0, {'prompt': 'invalid', 'completion': 'missing'})),
])
def test_normalize_reported_counters_without_guessing(usage, expected):
    assert reported_usage(usage) == expected


def test_anthropic_input_output_keys():
    assert reported_usage({'input_tokens': 3, 'output_tokens': 5}, 'input_tokens', 'output_tokens')[:2] == (3, 5)


@pytest.mark.asyncio
async def test_cancelled_agent_resets_its_observer():
    class CancelledAgent(Agent):
        async def run(self, **kwargs):
            raise asyncio.CancelledError()
    agent = CancelledAgent(make_agent().db, 1)
    with pytest.raises(asyncio.CancelledError):
        await agent.execute()
    assert completion_observer.get() is None


@pytest.mark.asyncio
async def test_standalone_provider_does_not_create_agent_usage_state():
    provider = Provider('configured')
    provider.response = response()
    assert await provider.complete_json([AIMessage(role='user', content='private')]) == {}
    assert completion_observer.get() is None


@pytest.mark.asyncio
async def test_transport_failure_without_returned_response_has_no_receipt():
    class FailedProvider(Provider):
        async def complete(self, messages, **kwargs):
            raise ValueError('transport unavailable')
    class FailedAgent(Agent):
        async def run(self, **kwargs):
            return await FailedProvider('test').complete_json([])
    agent = FailedAgent(make_agent().db, 1)
    with pytest.raises(ValueError):
        await agent.execute()
    assert not receipts(agent) and agent._run.prompt_tokens == 0
    assert completion_observer.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['anthropic', 'openai'])
@pytest.mark.parametrize('usage', [
    None, {},
    {'input_tokens': 0, 'output_tokens': 3, 'prompt_tokens': 0, 'completion_tokens': 3},
    {'input_tokens': True, 'output_tokens': -1, 'prompt_tokens': True, 'completion_tokens': -1},
])
async def test_real_provider_json_path_records_counter_presence_before_invalid_json(kind, usage):
    from backend.services.ai.anthropic_provider import AnthropicProvider
    from backend.services.ai.openai_provider import OpenAICompatibleProvider
    provider_class = AnthropicProvider if kind == 'anthropic' else OpenAICompatibleProvider
    provider = provider_class('configured', api_key='test-only')
    data = {'model': 'reported-model', 'usage': usage,
            'content': [{'type': 'text', 'text': 'invalid JSON'}],
            'choices': [{'message': {'content': 'invalid JSON'}}]}
    class ProviderAgent(Agent):
        async def run(self, **kwargs):
            return await provider.complete_json([AIMessage(role='user', content='private')])
    agent = ProviderAgent(make_agent().db, 1)
    with patch('httpx.AsyncClient.post', new_callable=AsyncMock) as post:
        reply = MagicMock()
        reply.json.return_value = data
        post.return_value = reply
        with pytest.raises(json.JSONDecodeError):
            await agent.execute()
    receipt = receipts(agent)[0]
    expected = 'missing' if not usage else 'invalid' if usage['input_tokens'] is True else 'reported'
    assert receipt['prompt_state'] == expected
    assert receipt['prompt'] == (0 if expected == 'reported' else None)
    assert agent._run.model_used == 'reported-model' and agent._run.status == 'failed'


def test_committed_usage_receipt_is_readable_only_as_its_owned_run(ledger):  # noqa: F811
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    client, owner, other, _, sessions = ledger
    path = sessions.kw['bind'].url.database
    async def execute():
        engine = create_async_engine('sqlite+aiosqlite:///' + path)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                agent = Agent(db, owner.id)
                await agent.execute(responses=[response(10, 4)])
                return agent._run.id
        finally:
            await engine.dispose()
    run_id = asyncio.run(execute())
    detail = client.get(f'/api/v1/cases/agents/runs/{run_id}').json()
    assert detail['prompt_tokens'] == 10 and detail['completion_tokens'] == 4
    assert len(detail['steps']) == 1 and detail['steps'][0]['action'] == 'provider_usage_receipt'
    assert json.loads(detail['steps'][0]['output_summary'])['prompt_state'] == 'reported'
    from backend.routers.auth import get_current_user
    async def foreign():
        return other
    app.dependency_overrides[get_current_user] = foreign
    assert client.get(f'/api/v1/cases/agents/runs/{run_id}').status_code == 404
