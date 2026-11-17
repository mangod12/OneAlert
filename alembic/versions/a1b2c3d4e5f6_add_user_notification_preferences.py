"""Add per-user email notification preferences.

Revision ID: a1b2c3d4e5f6
Revises: c67c79f9a6fb
Create Date: 2026-11-18 02:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c67c79f9a6fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('email_notifications_enabled', sa.Boolean(), server_default='1', nullable=False),
    )
    op.add_column(
        'users',
        sa.Column('notify_min_severity', sa.String(), server_default='low', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('users', 'notify_min_severity')
    op.drop_column('users', 'email_notifications_enabled')
