"""Add edited_at to alert_notes.

Revision ID: d4e9b17f2a53
Revises: c3f8a92d1e47
Create Date: 2026-11-19 07:20:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'd4e9b17f2a53'
down_revision: str | None = 'c3f8a92d1e47'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'alert_notes' not in inspector.get_table_names():
        return
    columns = {col['name'] for col in inspector.get_columns('alert_notes')}
    if 'edited_at' not in columns:
        op.add_column('alert_notes', sa.Column('edited_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'alert_notes' in inspector.get_table_names():
        columns = {col['name'] for col in inspector.get_columns('alert_notes')}
        if 'edited_at' in columns:
            op.drop_column('alert_notes', 'edited_at')
