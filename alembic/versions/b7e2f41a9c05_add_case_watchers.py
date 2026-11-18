"""Add the case_watchers table.

Revision ID: b7e2f41a9c05
Revises: ac319608f458
Create Date: 2026-11-19 05:06:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'b7e2f41a9c05'
down_revision: str | None = 'ac319608f458'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'case_watchers' in inspector.get_table_names():
        return
    op.create_table(
        'case_watchers',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('case_id', sa.Integer(), sa.ForeignKey('cases.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('case_id', 'user_id', name='uq_case_watchers_case_user'),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'case_watchers' in inspector.get_table_names():
        op.drop_table('case_watchers')
