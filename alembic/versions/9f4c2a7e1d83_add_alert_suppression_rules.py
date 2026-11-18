"""Add alert_suppression_rules table.

Revision ID: 9f4c2a7e1d83
Revises: c8d9e0f1a2b3
Create Date: 2026-11-18 18:35:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9f4c2a7e1d83'
down_revision: Union[str, None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'alert_suppression_rules' in inspector.get_table_names():
        return
    op.create_table(
        'alert_suppression_rules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('cve_id', sa.String(), nullable=True),
        sa.Column('asset_id', sa.Integer(), nullable=True),
        sa.Column('severity', sa.String(), nullable=True),
        sa.Column('title_contains', sa.String(), nullable=True),
        sa.Column('duration_hours', sa.Integer(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['assets.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_alert_suppression_rules_id', 'alert_suppression_rules', ['id'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'alert_suppression_rules' not in inspector.get_table_names():
        return
    op.drop_index('ix_alert_suppression_rules_id', table_name='alert_suppression_rules')
    op.drop_table('alert_suppression_rules')
