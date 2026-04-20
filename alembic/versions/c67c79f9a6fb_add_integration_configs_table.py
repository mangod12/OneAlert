"""add integration_configs table

Revision ID: c67c79f9a6fb
Revises: 7d41bd0cf173
Create Date: 2026-04-20 18:21:26.184281

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c67c79f9a6fb'
down_revision: Union[str, None] = '7d41bd0cf173'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'integration_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('integration_type', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_integration_configs_id'), 'integration_configs', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_integration_configs_id'), table_name='integration_configs')
    op.drop_table('integration_configs')
