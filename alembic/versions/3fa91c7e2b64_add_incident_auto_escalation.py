"""Add incident auto-escalation columns to users.

Revision ID: 3fa91c7e2b64
Revises: 9f4c2a7e1d83
Create Date: 2026-11-18 19:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3fa91c7e2b64'
down_revision: Union[str, None] = '9f4c2a7e1d83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'auto_escalate_incidents' not in columns:
        op.add_column('users', sa.Column('auto_escalate_incidents', sa.Boolean(), nullable=False, server_default='0'))
    if 'auto_escalate_min_alerts' not in columns:
        op.add_column('users', sa.Column('auto_escalate_min_alerts', sa.Integer(), nullable=False, server_default='3'))
    if 'auto_escalate_min_severity' not in columns:
        op.add_column('users', sa.Column('auto_escalate_min_severity', sa.String(), nullable=False, server_default='high'))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'auto_escalate_min_severity' in columns:
        op.drop_column('users', 'auto_escalate_min_severity')
    if 'auto_escalate_min_alerts' in columns:
        op.drop_column('users', 'auto_escalate_min_alerts')
    if 'auto_escalate_incidents' in columns:
        op.drop_column('users', 'auto_escalate_incidents')
