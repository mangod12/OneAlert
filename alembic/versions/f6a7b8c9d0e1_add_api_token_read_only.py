"""Add read_only column to api_tokens.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-11-18 10:20:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The api_tokens table predates the migration chain on some installs
    # (created via metadata create_all), so guard both steps.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'api_tokens' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('api_tokens')]
    if 'read_only' not in columns:
        op.add_column(
            'api_tokens',
            sa.Column('read_only', sa.Boolean(), nullable=False, server_default='0'),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'api_tokens' not in inspector.get_table_names():
        return
    columns = [c['name'] for c in inspector.get_columns('api_tokens')]
    if 'read_only' in columns:
        op.drop_column('api_tokens', 'read_only')
