"""Repair model tables missing from the original migration chain.

Revision ID: a7d92e4c610f
Revises: f6a2d94b8c75
"""

from backend.database.migration_schema_20261126 import upgrade_missing_tables

revision = "a7d92e4c610f"
down_revision = "f6a2d94b8c75"
branch_labels = None
depends_on = None


def upgrade() -> None:
    upgrade_missing_tables()


def downgrade() -> None:
    raise RuntimeError(
        "Additive schema repair cannot be downgraded automatically; "
        "preserve data and restore a reviewed backup if needed."
    )
