"""Personal API tokens: programmatic access to the API as the owning user."""

import hashlib
from datetime import datetime

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from backend.database.db import Base

TOKEN_PREFIX = "oa_"

# OWASP-recommended scrypt parameters; tokens are high-entropy but a memory-hard
# KDF keeps a database leak from enabling offline verification.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1


def hash_api_token(raw_token: str, salt_hex: str) -> str:
    return hashlib.scrypt(
        raw_token.encode("utf-8"),
        salt=bytes.fromhex(salt_hex),
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
    ).hex()


class ApiToken(Base):
    """A hashed personal API token owned by one user. The raw token is never stored."""

    __tablename__ = "api_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(80), nullable=False)
    prefix = Column(String(12), nullable=False, index=True)  # display hint, e.g. "oa_ab12cd34"
    salt = Column(String(32), nullable=False)  # per-token scrypt salt, hex
    token_hash = Column(String(128), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    expires_in_days: int | None = Field(default=None, ge=1, le=365)
    model_config = {"extra": "forbid"}


class ApiTokenResponse(BaseModel):
    id: int
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None

    class Config:
        from_attributes = True


class ApiTokenCreatedResponse(ApiTokenResponse):
    """The only response that ever includes the raw token."""

    token: str
