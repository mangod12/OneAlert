"""Manage personal API tokens."""

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.api_token import (
    TOKEN_PREFIX,
    ApiToken,
    ApiTokenCreate,
    ApiTokenCreatedResponse,
    ApiTokenResponse,
    hash_api_token,
)
from backend.models.user import User
from backend.services.audit import add_audit_log

router = APIRouter()

MAX_ACTIVE_TOKENS_PER_USER = 20


def _utcnow() -> datetime:
    """Naive UTC now, matching the timestamps stored by the rest of the app."""
    return datetime.now(UTC).replace(tzinfo=None)


def generate_api_token() -> tuple[str, str]:
    """Return (raw token, display prefix). The raw token is shown exactly once."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    return raw, raw[:12]


@router.get("/", response_model=list[ApiTokenResponse])
async def list_api_tokens(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """List the current user's API tokens, newest first. Raw tokens are never returned."""
    result = await db.execute(
        select(ApiToken)
        .where(ApiToken.user_id == current_user.id)
        .order_by(ApiToken.created_at.desc(), ApiToken.id.desc())
    )
    return list(result.scalars().all())


@router.post("/", response_model=ApiTokenCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_api_token(
    payload: ApiTokenCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Create an API token. The raw token is returned only in this response."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Token name cannot be blank")
    active = await db.execute(
        select(func.count(ApiToken.id)).where(
            ApiToken.user_id == current_user.id, ApiToken.revoked_at.is_(None)
        )
    )
    if (active.scalar() or 0) >= MAX_ACTIVE_TOKENS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"API tokens are limited to {MAX_ACTIVE_TOKENS_PER_USER} active tokens per user",
        )
    raw, prefix = generate_api_token()
    salt = secrets.token_hex(16)
    token = ApiToken(
        user_id=current_user.id,
        name=name,
        prefix=prefix,
        salt=salt,
        token_hash=hash_api_token(raw, salt),
        read_only=payload.read_only,
        expires_at=(
            _utcnow() + timedelta(days=payload.expires_in_days)
            if payload.expires_in_days is not None
            else None
        ),
    )
    db.add(token)
    await db.flush()
    add_audit_log(
        db,
        user_id=current_user.id,
        action="api_token_created",
        target_type="api_token",
        target_id=token.id,
        detail=f"Token '{name}' ({prefix}…) created"
        + (" (read-only)" if payload.read_only else ""),
    )
    await db.commit()
    await db.refresh(token)
    created = ApiTokenResponse.model_validate(token)
    return ApiTokenCreatedResponse(**created.model_dump(), token=raw)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_token(
    token_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke one of the current user's active API tokens."""
    result = await db.execute(
        select(ApiToken).where(
            ApiToken.id == token_id,
            ApiToken.user_id == current_user.id,
            ApiToken.revoked_at.is_(None),
        )
    )
    token = result.scalar_one_or_none()
    if token is None:
        raise HTTPException(status_code=404, detail="API token not found")
    token.revoked_at = _utcnow()
    add_audit_log(
        db,
        user_id=current_user.id,
        action="api_token_revoked",
        target_type="api_token",
        target_id=token.id,
        detail=f"Token '{token.name}' ({token.prefix}…) revoked",
    )
    await db.commit()
