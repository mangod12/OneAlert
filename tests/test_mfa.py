"""Tests for MFA/TOTP implementation."""

import pytest


def test_pyotp_generates_valid_secret():
    """pyotp should generate a valid base32 secret."""
    import pyotp
    secret = pyotp.random_base32()
    assert len(secret) == 32
    totp = pyotp.TOTP(secret)
    code = totp.now()
    assert len(code) == 6
    assert totp.verify(code)


def test_pyotp_provisioning_uri():
    """Should generate a valid provisioning URI."""
    import pyotp
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name="test@example.com", issuer_name="OneAlert")
    assert uri.startswith("otpauth://totp/")
    assert "OneAlert" in uri


def test_pyotp_rejects_invalid_code():
    """Invalid TOTP codes should be rejected."""
    import pyotp
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    assert not totp.verify("000000")


def test_pyotp_valid_window():
    """TOTP verification with valid_window should accept nearby codes."""
    import pyotp
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    code = totp.now()
    assert totp.verify(code, valid_window=1)


def _mock_user(mfa_enabled=False, mfa_secret=None):
    from unittest.mock import Mock
    from backend.models.user import User
    user = Mock(spec=User)
    user.id = 1
    user.email = "analyst@example.com"
    user.mfa_enabled = mfa_enabled
    user.mfa_secret = mfa_secret
    return user


def _mock_db():
    from unittest.mock import AsyncMock
    db = AsyncMock()
    db.add = lambda obj: None
    return db


@pytest.mark.asyncio
async def test_setup_stores_secret_but_keeps_mfa_disabled():
    """Setup must not enable MFA before the first code verifies."""
    from backend.routers.auth import setup_mfa
    user = _mock_user()
    db = _mock_db()
    result = await setup_mfa(current_user=user, db=db)
    assert result["mfa_enabled"] is False
    assert result["provisioning_uri"].startswith("otpauth://totp/")
    assert user.mfa_secret  # pending secret stored
    assert user.mfa_enabled is False  # not yet enabled


@pytest.mark.asyncio
async def test_setup_returns_existing_uri_when_already_enabled():
    import pyotp
    from backend.routers.auth import setup_mfa
    secret = pyotp.random_base32()
    user = _mock_user(mfa_enabled=True, mfa_secret=secret)
    result = await setup_mfa(current_user=user, db=_mock_db())
    assert result["mfa_enabled"] is True
    assert result["provisioning_uri"] == pyotp.TOTP(secret).provisioning_uri(
        name="analyst@example.com", issuer_name="OneAlert"
    )


@pytest.mark.asyncio
async def test_verify_valid_code_enables_mfa():
    import pyotp
    from backend.routers.auth import MFAVerifyRequest, verify_mfa
    secret = pyotp.random_base32()
    user = _mock_user(mfa_secret=secret)
    db = _mock_db()
    code = pyotp.TOTP(secret).now()
    assert await verify_mfa(MFAVerifyRequest(code=code), current_user=user, db=db) is True
    assert user.mfa_enabled is True
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_verify_invalid_code_keeps_mfa_disabled():
    import pyotp
    from backend.routers.auth import MFAVerifyRequest, verify_mfa
    user = _mock_user(mfa_secret=pyotp.random_base32())
    db = _mock_db()
    assert await verify_mfa(MFAVerifyRequest(code="000000"), current_user=user, db=db) is False
    assert user.mfa_enabled is False
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_verify_without_setup_returns_false():
    from backend.routers.auth import MFAVerifyRequest, verify_mfa
    user = _mock_user()
    assert await verify_mfa(MFAVerifyRequest(code="123456"), current_user=user, db=_mock_db()) is False
