"""
Regression test: the legacy reversible Alembic chain must run cleanly on a
fresh SQLite database (dev/docker-compose default), and back down again.

Guard for the bug where e5c07dc452f3 used op.create_foreign_key outside
batch mode, which raises NotImplementedError on SQLite and made
`alembic upgrade head` fail on any fresh dev setup.
"""

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from backend.config import settings

REPO_ROOT = Path(__file__).resolve().parent.parent


def _table_names(db_path: Path) -> set:
    conn = sqlite3.connect(db_path)
    try:
        return {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    finally:
        conn.close()


def test_legacy_alembic_upgrade_and_downgrade_on_sqlite(tmp_path, monkeypatch):
    db_path = tmp_path / "migrations_test.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{db_path}")

    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "alembic"))

    # The later additive schema repair intentionally blocks destructive downgrade.
    # Full head coverage and its retention guard live in test_missing_table_migration.
    command.upgrade(cfg, "ac319608f458")

    tables = _table_names(db_path)
    assert "users" in tables
    assert "organizations" in tables
    assert "integration_configs" in tables  # last migration in the chain

    command.downgrade(cfg, "base")

    tables = _table_names(db_path)
    assert "users" not in tables
    assert "organizations" not in tables
