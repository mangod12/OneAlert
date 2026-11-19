"""Add the alert_watchers table.

Revision ID: c3f8a92d1e47
Revises: b7e2f41a9c05
Create Date: 2026-11-19 06:08:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'c3f8a92d1e47'
down_revision: str | None = 'b7e2f41a9c05'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'alert_watchers' in inspector.get_table_names():
        return
    op.create_table(
        'alert_watchers',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('alert_id', sa.Integer(), sa.ForeignKey('alerts.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('alert_id', 'user_id', name='uq_alert_watchers_alert_user'),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'alert_watchers' in inspector.get_table_names():
        op.drop_table('alert_watchers')
