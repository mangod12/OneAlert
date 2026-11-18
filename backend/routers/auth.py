"""
Authentication router for user registration, login, and JWT token management.
Handles user authentication, password hashing, and JWT token creation/validation.
"""

import csv
import io
import logging
import secrets
import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, ConfigDict, HttpUrl, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database.db import get_async_db
from backend.middleware.rate_limiter import limiter
from backend.models.api_token import TOKEN_PREFIX, ApiToken, hash_api_token
from backend.models.audit_log import AuditLog
from backend.models.user import (
    NotificationPreferences,
    NotificationPreferencesUpdate,
    Token,
    User,
    UserCreate,
    UserResponse,
)
from backend.services.auth_service import create_access_token, get_password_hash, verify_password, verify_token
from backend.services.github_auth_service import github_auth_service

logger = logging.getLogger(__name__)

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
GITHUB_STATE_TTL_SECONDS = 600
_pending_github_states: dict[str, float] = {}


def _store_github_state(state: str) -> None:
    """Store a short-lived OAuth state server-side for CSRF validation."""
    now = time.time()
    expired = [key for key, expires_at in _pending_github_states.items() if expires_at <= now]
    for key in expired:
        _pending_github_states.pop(key, None)
    _pending_github_states[state] = now + GITHUB_STATE_TTL_SECONDS


def _consume_github_state(state: str) -> bool:
    """Consume a pending OAuth state value exactly once."""
    expires_at = _pending_github_states.pop(state, None)
    return expires_at is not None and expires_at > time.time()


async def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_async_db)
) -> User:
    """Get current authenticated user from JWT token or httpOnly cookie."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Fallback to cookie if no Bearer token
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise credentials_exception

    # Personal API tokens authenticate as their owner
    if token.startswith(TOKEN_PREFIX):
        candidates = await db.execute(
            select(ApiToken).where(ApiToken.prefix == token[:12])
        )
        api_token = next(
            (
                row
                for row in candidates.scalars().all()
                if row.token_hash == hash_api_token(token, row.salt)
            ),
            None,
        )
        now = datetime.now(UTC).replace(tzinfo=None)  # naive UTC, matching stored timestamps
        if (
            api_token is None
            or api_token.revoked_at is not None
            or (api_token.expires_at is not None and api_token.expires_at <= now)
        ):
            raise credentials_exception
        result = await db.execute(select(User).where(User.id == api_token.user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise credentials_exception
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Inactive user",
            )
        api_token.last_used_at = now
        await db.commit()
        return user

    # Verify token and get email
    email = verify_token(token)
    if email is None:
        raise credentials_exception

    # Get user from database
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    return user


async def get_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Get current active user."""
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/minute")
async def register_user(
    request: Request,
    user_data: UserCreate,
    db: AsyncSession = Depends(get_async_db)
):
    """Register a new user."""
    # Check if user already exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    db_user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        full_name=user_data.full_name,
        company=user_data.company,
        is_active=True,
        is_verified=False  # Email verification would be implemented here
    )

    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)

    return db_user


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
async def login_user(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_async_db)
):
    """Authenticate user and return JWT token."""
    # Get user by email
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()

    # Verify user and password
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Check MFA if enabled
    if user.mfa_enabled and user.mfa_secret:
        import pyotp
        mfa_code = form_data.scopes[0] if form_data.scopes else None
        if not mfa_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="MFA code required",
            )
        totp = pyotp.TOTP(user.mfa_secret)
        if not totp.verify(mfa_code, valid_window=1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid MFA code",
            )

    # Create access token
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )

    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/logout")
async def logout_user(response: Response):
    """Expire the browser session cookie; safe to call even when logged out."""
    response.delete_cookie(
        key="access_token",
        path="/",
        secure=settings.environment == "production",
        httponly=True,
        samesite="lax",
    )
    return {"success": True}


@router.get("/me", response_model=UserResponse)
async def read_current_user(current_user: User = Depends(get_active_user)):
    """Get current user profile."""
    return current_user


@router.get("/me/notification-preferences", response_model=NotificationPreferences)
async def read_notification_preferences(current_user: User = Depends(get_active_user)):
    """Get the current user's email notification preferences."""
    return current_user


@router.patch("/me/notification-preferences", response_model=NotificationPreferences)
async def update_notification_preferences(
    update: NotificationPreferencesUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update the current user's email notification preferences."""
    if update.email_notifications_enabled is not None:
        current_user.email_notifications_enabled = update.email_notifications_enabled
    if update.notify_min_severity is not None:
        current_user.notify_min_severity = update.notify_min_severity
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/verify-token")
async def verify_user_token(current_user: User = Depends(get_active_user)):
    """Verify if the current token is valid."""
    return {"valid": True, "user_id": current_user.id, "email": current_user.email}


@router.get("/github/login")
async def github_login():
    """Get GitHub OAuth authorization URL."""
    try:
        oauth_state = secrets.token_urlsafe(32)
        _store_github_state(oauth_state)
        auth_url = github_auth_service.get_authorization_url(oauth_state)
        return {"auth_url": auth_url}
    except ValueError as e:
        logger.error("GitHub OAuth is misconfigured: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GitHub sign-in is not configured correctly",
        ) from e
    except Exception as e:
        logger.error("Failed to generate GitHub auth URL: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GitHub sign-in could not be started",
        ) from e


@router.get("/github/callback")
async def github_callback(code: str, state: str | None = None):
    """Handle GitHub OAuth callback and authenticate user."""
    from fastapi.responses import RedirectResponse
    try:
        if not state:
            raise HTTPException(status_code=400, detail="State parameter missing from GitHub callback")
        if not _consume_github_state(state):
            raise HTTPException(status_code=400, detail="Invalid state")
        # Complete GitHub OAuth flow with CSRF protection
        result = await github_auth_service.authenticate_user(code, state, state)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="GitHub authentication failed"
            )
        # Set token as httpOnly cookie instead of URL fragment
        access_token = result.get("access_token")
        if access_token:
            response = RedirectResponse(url="/app/", status_code=302)
            response.set_cookie(
                key="access_token",
                value=access_token,
                httponly=True,
                secure=True,
                samesite="lax",
                max_age=settings.access_token_expire_minutes * 60,
                path="/",
            )
            return response
        return RedirectResponse(url="/app/?github_error=1")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("GitHub callback failed: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GitHub sign-in could not be completed",
        ) from e


class WebhookIntegrationsUpdate(BaseModel):
    """Write-only notification endpoints; credentials are never serialized back."""

    slack_webhook_url: HttpUrl | None = None
    webhook_url: HttpUrl | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator("slack_webhook_url", "webhook_url")
    @classmethod
    def require_https(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is not None and value.scheme != "https":
            raise ValueError("Webhook URLs must use HTTPS")
        return value


@router.patch("/me/integrations", response_model=UserResponse)
async def update_my_integrations(
    payload: WebhookIntegrationsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Update Slack/Webhook integration URLs for the current user."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, str(value) if value is not None else None)
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/me/mfa/setup")
async def setup_mfa(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_async_db)):
    """Start MFA setup: store a pending secret and return its provisioning URI.

    MFA stays disabled until the first code verifies via /me/mfa/verify, so a
    user who abandons setup is never locked out of password sign-in.
    """
    import pyotp
    if current_user.mfa_enabled and current_user.mfa_secret:
        totp = pyotp.TOTP(current_user.mfa_secret)
        return {
            "mfa_enabled": True,
            "provisioning_uri": totp.provisioning_uri(
                name=current_user.email, issuer_name="OneAlert"
            ),
        }
    secret = pyotp.random_base32()
    current_user.mfa_secret = secret
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    totp = pyotp.TOTP(secret)
    return {
        "mfa_enabled": False,
        "provisioning_uri": totp.provisioning_uri(
            name=current_user.email, issuer_name="OneAlert"
        ),
    }


class MFAVerifyRequest(BaseModel):
    """Request body for MFA verification."""
    code: str


@router.post("/me/mfa/verify", response_model=bool)
async def verify_mfa(
    body: MFAVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Verify a TOTP code; enables MFA on the first successful verification."""
    import pyotp
    if not current_user.mfa_secret:
        return False
    totp = pyotp.TOTP(current_user.mfa_secret)
    if not totp.verify(body.code):
        return False
    if not current_user.mfa_enabled:
        current_user.mfa_enabled = True
        db.add(current_user)
        await db.commit()
    return True


@router.get("/audit-logs")
async def get_audit_logs(
    action: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Admin: Get audit logs scoped to the admin's organization, with action filtering and pagination."""
    if not current_user.role or current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    # Scope audit logs to admin's org members (or just their own if no org)
    if current_user.org_id:
        org_user_ids = (await db.execute(
            select(User.id).where(User.org_id == current_user.org_id)
        )).scalars().all()
        scope = AuditLog.user_id.in_(org_user_ids)
    else:
        scope = AuditLog.user_id == current_user.id
    if action:
        escaped = action.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        scope = scope & (AuditLog.action.ilike(f"%{escaped}%", escape="\\"))

    total = (await db.execute(
        select(func.count()).select_from(AuditLog).where(scope)
    )).scalar_one()
    result = await db.execute(
        select(AuditLog)
        .where(scope)
        .order_by(AuditLog.timestamp.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    logs = result.scalars().all()
    return {
        "total": total,
        "logs": [
            {
                "id": log.id,
                "user_id": log.user_id,
                "action": log.action,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "detail": log.detail,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None
            }
            for log in logs
        ],
    }


@router.get("/audit-logs/export")
async def export_audit_logs(
    action: str | None = Query(None, max_length=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Admin: export org audit logs as CSV (same scoping/filter as the list, max 5000 rows)."""
    if not current_user.role or current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    if current_user.org_id:
        org_user_ids = (await db.execute(
            select(User.id).where(User.org_id == current_user.org_id)
        )).scalars().all()
        scope = AuditLog.user_id.in_(org_user_ids)
    else:
        scope = AuditLog.user_id == current_user.id
    if action:
        escaped = action.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        scope = scope & (AuditLog.action.ilike(f"%{escaped}%", escape="\\"))

    result = await db.execute(
        select(AuditLog, User.email)
        .join(User, AuditLog.user_id == User.id)
        .where(scope)
        .order_by(AuditLog.timestamp.desc())
        .limit(5000)
    )
    rows = result.all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "timestamp", "user_email", "action", "target_type", "target_id", "detail"])
    for log, email in rows:
        writer.writerow([
            log.id,
            log.timestamp.isoformat() if log.timestamp else "",
            email,
            log.action,
            log.target_type or "",
            log.target_id or "",
            log.detail or "",
        ])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit-logs.csv"},
    )
