"""add sbom tables

Revision ID: 116233459d0d
Revises: d2406be7b568
Create Date: 2026-04-20 16:34:19.873884

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '116233459d0d'
down_revision: Union[str, None] = 'd2406be7b568'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sboms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("format", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("component_count", sa.Integer(), nullable=True),
        sa.Column("vulnerability_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sboms_id"), "sboms", ["id"], unique=False)

    op.create_table(
        "sbom_components",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sbom_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=True),
        sa.Column("supplier", sa.String(), nullable=True),
        sa.Column("purl", sa.String(), nullable=True),
        sa.Column("cpe", sa.String(), nullable=True),
        sa.Column("license", sa.String(), nullable=True),
        sa.Column("hash_sha256", sa.String(), nullable=True),
        sa.Column("has_known_vulnerability", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["sbom_id"], ["sboms.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_sbom_components_id"), "sbom_components", ["id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_sbom_components_id"), table_name="sbom_components")
    op.drop_table("sbom_components")
    op.drop_index(op.f("ix_sboms_id"), table_name="sboms")
    op.drop_table("sboms")
