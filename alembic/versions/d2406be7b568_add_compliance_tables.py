"""add compliance tables

Revision ID: d2406be7b568
Revises: 466d87729b1a
Create Date: 2026-04-20 16:20:57.714652

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2406be7b568'
down_revision: Union[str, None] = '466d87729b1a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'compliance_frameworks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('version', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_compliance_frameworks_id'), 'compliance_frameworks', ['id'], unique=False)

    op.create_table(
        'compliance_controls',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('framework_id', sa.Integer(), nullable=False),
        sa.Column('control_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['framework_id'], ['compliance_frameworks.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_compliance_controls_id'), 'compliance_controls', ['id'], unique=False)

    op.create_table(
        'compliance_assessments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('control_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('evidence_type', sa.String(), nullable=True),
        sa.Column('evidence_detail', sa.Text(), nullable=True),
        sa.Column('assessed_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('assessed_by', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['control_id'], ['compliance_controls.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_compliance_assessments_id'), 'compliance_assessments', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_compliance_assessments_id'), table_name='compliance_assessments')
    op.drop_table('compliance_assessments')
    op.drop_index(op.f('ix_compliance_controls_id'), table_name='compliance_controls')
    op.drop_table('compliance_controls')
    op.drop_index(op.f('ix_compliance_frameworks_id'), table_name='compliance_frameworks')
    op.drop_table('compliance_frameworks')
