"""Add user_id to case timeline entries for note author attribution.

Revision ID: f6a2d94b8c75
Revises: e5f1c83a7b64
Create Date: 2026-11-19 07:55:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'f6a2d94b8c75'
down_revision: str | None = 'e5f1c83a7b64'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'case_timeline' not in inspector.get_table_names():
        return
    columns = {col['name'] for col in inspector.get_columns('case_timeline')}
    if 'user_id' not in columns:
        op.add_column(
            'case_timeline',
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'case_timeline' in inspector.get_table_names():
        columns = {col['name'] for col in inspector.get_columns('case_timeline')}
        if 'user_id' in columns:
            op.drop_column('case_timeline', 'user_id')
