"""
Rate limiting middleware using slowapi.
Protects authentication endpoints from brute-force attacks.
"""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from fastapi.responses import JSONResponse

_enabled = not os.getenv("TESTING")
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],
    enabled=_enabled,
)


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please try again later.",
            "status_code": 429,
        },
    )
