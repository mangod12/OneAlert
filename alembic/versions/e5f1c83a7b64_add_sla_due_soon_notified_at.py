"""Add sla_due_soon_notified_at to cases.

Revision ID: e5f1c83a7b64
Revises: d4e9b17f2a53
Create Date: 2026-11-19 07:52:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'e5f1c83a7b64'
down_revision: str | None = 'd4e9b17f2a53'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'cases' not in inspector.get_table_names():
        return
    columns = {col['name'] for col in inspector.get_columns('cases')}
    if 'sla_due_soon_notified_at' not in columns:
        op.add_column('cases', sa.Column('sla_due_soon_notified_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'cases' in inspector.get_table_names():
        columns = {col['name'] for col in inspector.get_columns('cases')}
        if 'sla_due_soon_notified_at' in columns:
            op.drop_column('cases', 'sla_due_soon_notified_at')
