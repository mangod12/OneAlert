"""Request metrics middleware — tracks request counts and latencies."""

import time
from collections import defaultdict, deque
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


# In-memory metrics store (bounded to prevent memory leaks)
_request_counts: dict = defaultdict(int)
_request_durations: dict = defaultdict(lambda: deque(maxlen=1000))
_error_counts: dict = defaultdict(int)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Track request count and duration per endpoint."""

    async def dispatch(self, request: Request, call_next) -> Response:
        start_time = time.time()
        path = request.url.path
        method = request.method

        response = await call_next(request)

        duration = time.time() - start_time
        key = f"{method} {path}"

        _request_counts[key] += 1
        _request_durations[key].append(duration)

        if response.status_code >= 400:
            _error_counts[key] += 1

        return response


def get_metrics_summary() -> dict:
    """Get current metrics summary."""
    summary = {}
    for key, count in _request_counts.items():
        durations = _request_durations.get(key, [])
        avg_duration = sum(durations) / len(durations) if durations else 0
        summary[key] = {
            "count": count,
            "errors": _error_counts.get(key, 0),
            "avg_duration_ms": round(avg_duration * 1000, 2),
            "p95_duration_ms": round(
                sorted(durations)[int(len(durations) * 0.95)] * 1000, 2
            )
            if len(durations) > 1
            else round(avg_duration * 1000, 2),
        }
    return summary


def reset_metrics():
    """Reset all metrics (for testing)."""
    _request_counts.clear()
    _request_durations.clear()
    _error_counts.clear()
