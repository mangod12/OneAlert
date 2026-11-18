"""Shared audit-trail writer for security-relevant mutations.

Callers add the entry inside their own transaction: the endpoint's
existing commit persists it atomically with the change it records.
Never include secrets (raw tokens, webhook URLs, passwords) in detail.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.audit_log import AuditLog


def add_audit_log(
    db: AsyncSession,
    *,
    user_id: int | None,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    detail: str | None = None,
) -> None:
    """Queue an audit log entry in the caller's session (no commit)."""
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail,
    ))
