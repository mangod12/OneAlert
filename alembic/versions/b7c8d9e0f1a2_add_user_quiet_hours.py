"""Add quiet_hours_start and quiet_hours_end columns to users.

Revision ID: b7c8d9e0f1a2
Revises: f6a7b8c9d0e1
Create Date: 2026-11-18 17:42:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'quiet_hours_start' not in columns:
        op.add_column('users', sa.Column('quiet_hours_start', sa.String(), nullable=True))
    if 'quiet_hours_end' not in columns:
        op.add_column('users', sa.Column('quiet_hours_end', sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'quiet_hours_end' in columns:
        op.drop_column('users', 'quiet_hours_end')
    if 'quiet_hours_start' in columns:
        op.drop_column('users', 'quiet_hours_start')
