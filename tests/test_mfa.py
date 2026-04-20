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
