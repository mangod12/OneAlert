"""add organizations table and user org_id

Revision ID: e5c07dc452f3
Revises: 86ee7683b22f
Create Date: 2026-04-20 15:59:39.891597

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5c07dc452f3'
down_revision: Union[str, None] = '86ee7683b22f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create organizations table
    op.create_table(
        'organizations',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False),
        sa.Column('plan', sa.String(), server_default='free'),
        sa.Column('max_assets', sa.Integer(), server_default='50'),
        sa.Column('max_users', sa.Integer(), server_default='3'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_organizations_id', 'organizations', ['id'])
    op.create_index('ix_organizations_slug', 'organizations', ['slug'], unique=True)

    # Add org_id column to users table
    op.add_column('users', sa.Column('org_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_users_org_id',
        'users',
        'organizations',
        ['org_id'],
        ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_users_org_id', 'users', type_='foreignkey')
    op.drop_column('users', 'org_id')
    op.drop_index('ix_organizations_slug', table_name='organizations')
    op.drop_index('ix_organizations_id', table_name='organizations')
    op.drop_table('organizations')
