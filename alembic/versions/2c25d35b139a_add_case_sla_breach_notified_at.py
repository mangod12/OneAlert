"""Add sla_breach_notified_at to cases.

Revision ID: 2c25d35b139a
Revises: 440e31ec610c
Create Date: 2026-11-18 20:20:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '2c25d35b139a'
down_revision: Union[str, None] = '440e31ec610c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'cases' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('cases')]
    if 'sla_breach_notified_at' not in columns:
        op.add_column('cases', sa.Column('sla_breach_notified_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'cases' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('cases')]
    if 'sla_breach_notified_at' in columns:
        op.drop_column('cases', 'sla_breach_notified_at')
