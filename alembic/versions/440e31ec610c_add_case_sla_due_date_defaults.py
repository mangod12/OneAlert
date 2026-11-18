"""Add case SLA due-date default columns to users.

Revision ID: 440e31ec610c
Revises: 3fa91c7e2b64
Create Date: 2026-11-18 19:20:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '440e31ec610c'
down_revision: Union[str, None] = '3fa91c7e2b64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ('sla_due_dates_enabled', sa.Boolean(), '0'),
    ('sla_days_critical', sa.Integer(), '1'),
    ('sla_days_high', sa.Integer(), '3'),
    ('sla_days_medium', sa.Integer(), '7'),
    ('sla_days_low', sa.Integer(), '14'),
    ('sla_days_info', sa.Integer(), '30'),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    for name, coltype, default in _COLUMNS:
        if name not in columns:
            op.add_column('users', sa.Column(name, coltype, nullable=False, server_default=default))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    for name, _coltype, _default in reversed(_COLUMNS):
        if name in columns:
            op.drop_column('users', name)
