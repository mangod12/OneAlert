"""Task-local observations of provider-reported token counters, never prompt or output text."""
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

completion_observer: ContextVar[Callable[..., Awaitable[None]] | None] = ContextVar(
    'onealert_completion_observer', default=None)


def reported_usage(usage, prompt_key='prompt_tokens', completion_key='completion_tokens'):
    """Keep missing/invalid counters distinct from an explicitly reported zero."""
    values, states = {}, {}
    for label, key in (('prompt', prompt_key), ('completion', completion_key)):
        value = usage.get(key) if isinstance(usage, dict) else None
        valid = type(value) is int and 0 <= value <= 2**31 - 1
        values[label] = value if valid else 0
        states[label] = 'reported' if valid else 'missing' if value is None else 'invalid'
    return values['prompt'], values['completion'], states
