"""add network_connections table

Revision ID: 7d41bd0cf173
Revises: 597f5493fc0c
Create Date: 2026-04-20 16:42:42.719639

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7d41bd0cf173'
down_revision: Union[str, None] = '597f5493fc0c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'network_connections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('source_device_id', sa.Integer(), nullable=True),
        sa.Column('target_device_id', sa.Integer(), nullable=True),
        sa.Column('source_ip', sa.String(), nullable=False),
        sa.Column('target_ip', sa.String(), nullable=False),
        sa.Column('protocol', sa.String(), nullable=False),
        sa.Column('port', sa.Integer(), nullable=True),
        sa.Column('direction', sa.String(), nullable=True),
        sa.Column('first_seen', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column('last_seen', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column('bytes_transferred', sa.BigInteger(), nullable=True),
        sa.Column('is_encrypted', sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['source_device_id'], ['discovered_devices.id']),
        sa.ForeignKeyConstraint(['target_device_id'], ['discovered_devices.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_network_connections_id'), 'network_connections', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_network_connections_id'), table_name='network_connections')
    op.drop_table('network_connections')
