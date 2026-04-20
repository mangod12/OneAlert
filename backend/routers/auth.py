"""
Authentication router for user registration, login, and JWT token management.
Handles user authentication, password hashing, and JWT token creation/validation.
"""

from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, List

from backend.database.db import get_async_db
from backend.models.user import User, UserCreate, UserResponse, Token, GitHubUserCreate
from backend.models.audit_log import AuditLog
from backend.services.auth_service import (
    create_access_token,
    verify_password,
    get_password_hash,
    verify_token
)
from backend.services.github_auth_service import github_auth_service
from backend.config import settings
from backend.middleware.rate_limiter import limiter

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
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

    # Verify token and get email
    email = verify_token(token)
    if email is None:
        raise credentials_exception
    
    # Get user from database
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception
    
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

    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
async def read_current_user(current_user: User = Depends(get_active_user)):
    """Get current user profile."""
    return current_user


@router.post("/verify-token")
async def verify_user_token(current_user: User = Depends(get_active_user)):
    """Verify if the current token is valid."""
    return {"valid": True, "user_id": current_user.id, "email": current_user.email}


@router.get("/github/login")
async def github_login(state: Optional[str] = None):
    """Get GitHub OAuth authorization URL."""
    try:
        # Pass the state from the frontend to the service
        auth_url = github_auth_service.get_authorization_url(state)
        return {"auth_url": auth_url}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate GitHub auth URL: {str(e)}"
        )


@router.get("/github/callback")
async def github_callback(request: Request, code: str, state: Optional[str] = None):
    """Handle GitHub OAuth callback and authenticate user."""
    from fastapi.responses import RedirectResponse
    try:
        # Retrieve session_state from secure cookie/session (example: signed cookie)
        session_state = request.cookies.get("github_oauth_state")
        if not session_state:
            raise HTTPException(status_code=400, detail="Session state missing for CSRF protection")
        if not state:
            raise HTTPException(status_code=400, detail="State parameter missing from GitHub callback")
        # Complete GitHub OAuth flow with CSRF protection
        result = await github_auth_service.authenticate_user(code, session_state, state)
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
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"GitHub callback failed: {str(e)}"
        )


@router.patch("/me/integrations", response_model=UserResponse)
async def update_my_integrations(
    slack_webhook_url: Optional[str] = None,
    webhook_url: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Update Slack/Webhook integration URLs for the current user."""
    if slack_webhook_url is not None:
        current_user.slack_webhook_url = slack_webhook_url
    if webhook_url is not None:
        current_user.webhook_url = webhook_url
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/me/mfa/setup")
async def setup_mfa(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_async_db)):
    """Enable MFA for the current user and return the TOTP provisioning URI."""
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
    current_user.mfa_enabled = True
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    totp = pyotp.TOTP(secret)
    return {
        "mfa_enabled": True,
        "provisioning_uri": totp.provisioning_uri(
            name=current_user.email, issuer_name="OneAlert"
        ),
    }


@router.post("/me/mfa/verify", response_model=bool)
async def verify_mfa(code: str, current_user: User = Depends(get_current_user)):
    """Verify a TOTP code for the current user."""
    import pyotp
    if not current_user.mfa_enabled or not current_user.mfa_secret:
        return False
    totp = pyotp.TOTP(current_user.mfa_secret)
    return totp.verify(code)


@router.get("/audit-logs", response_model=List[dict])
async def get_audit_logs(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_async_db)):
    """Admin: Get all audit logs."""
    # Only allow admin users
    if not current_user.role or current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    result = await db.execute(select(AuditLog))
    logs = result.scalars().all()
    return [
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
    ]