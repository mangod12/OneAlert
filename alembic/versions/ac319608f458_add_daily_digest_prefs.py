"""Add daily digest preference columns to users.

Revision ID: ac319608f458
Revises: 2c25d35b139a
Create Date: 2026-11-18 20:55:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'ac319608f458'
down_revision: Union[str, None] = '2c25d35b139a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'digest_enabled' not in columns:
        op.add_column('users', sa.Column('digest_enabled', sa.Boolean(), nullable=False, server_default='0'))
    if 'digest_hour_utc' not in columns:
        op.add_column('users', sa.Column('digest_hour_utc', sa.Integer(), nullable=False, server_default='7'))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'digest_hour_utc' in columns:
        op.drop_column('users', 'digest_hour_utc')
    if 'digest_enabled' in columns:
        op.drop_column('users', 'digest_enabled')
