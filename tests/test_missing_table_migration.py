"""Exercise migration-created schemas without application create_all."""

import importlib
import os
import pkgutil
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config

from alembic import command
from backend import models
from backend.config import settings
from backend.database.db import Base

ROOT = Path(__file__).resolve().parents[1]
MISSING = {
    "agent_runs",
    "agent_steps",
    "api_tokens",
    "approval_requests",
    "case_alerts",
    "case_events",
    "case_tasks",
    "case_timeline",
    "cases",
    "control_results",
    "detection_rules",
    "event_sources",
    "hunt_sessions",
    "response_plans",
    "security_events",
    "validation_runs",
    "validation_steps",
}
for module in pkgutil.iter_modules(models.__path__):
    importlib.import_module("backend.models." + module.name)


def config(monkeypatch, url):
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    return cfg


def assert_schema(engine):
    inspector = sa.inspect(engine)
    assert set(Base.metadata.tables) <= set(inspector.get_table_names())
    for name in MISSING:
        table = Base.metadata.tables[name]
        actual = {column["name"]: column for column in inspector.get_columns(name)}
        assert set(actual) == set(table.columns.keys()), name
        for column in table.columns:
            assert actual[column.name]["nullable"] == column.nullable, (name, column.name)
        assert {index.name for index in table.indexes} == {index["name"] for index in inspector.get_indexes(name)}, name
        expected_fk = {
            (tuple(fk.parent.name for fk in constraint.elements), constraint.referred_table.name)
            for constraint in table.foreign_key_constraints
        }
        assert expected_fk == {
            (tuple(fk["constrained_columns"]), fk["referred_table"]) for fk in inspector.get_foreign_keys(name)
        }, name


def test_fresh_sqlite_schema_has_every_model_table(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'fresh.db'}"
    cfg = config(monkeypatch, url)
    command.upgrade(cfg, "head")
    engine = sa.create_engine(url)
    assert_schema(engine)
    command.upgrade(cfg, "head")
    with pytest.raises(RuntimeError, match="cannot be downgraded"):
        command.downgrade(cfg, "f6a2d94b8c75")
    assert_schema(engine)
    engine.dispose()


def test_previously_stamped_database_gets_missing_tables_and_preserves_data(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'stamped.db'}"
    cfg = config(monkeypatch, url)
    command.upgrade(cfg, "f6a2d94b8c75")
    engine = sa.create_engine(url)
    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO users (id,email) VALUES (1,'preserved@example.test')"))
        for table in reversed(Base.metadata.sorted_tables):
            if table.name in MISSING:
                table.drop(conn)
    command.upgrade(cfg, "head")
    assert_schema(engine)
    with engine.connect() as conn:
        assert conn.scalar(sa.text("SELECT email FROM users WHERE id=1")) == "preserved@example.test"
    engine.dispose()


def test_existing_model_tables_and_rows_are_not_recreated(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'existing.db'}"
    cfg = config(monkeypatch, url)
    engine = sa.create_engine(url)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO users (id,email) VALUES (1,'owner@example.test')"))
        conn.execute(sa.text("INSERT INTO cases (id,user_id,title) VALUES (1,1,'Keep investigation')"))
        conn.execute(
            sa.text("INSERT INTO case_tasks (id,case_id,title,done,position) VALUES (1,1,'Keep task',false,0)")
        )
    command.stamp(cfg, "f6a2d94b8c75")
    command.upgrade(cfg, "head")
    assert_schema(engine)
    with engine.connect() as conn:
        assert conn.scalar(sa.text("SELECT title FROM case_tasks WHERE id=1")) == "Keep task"
    engine.dispose()


@pytest.mark.skipif(not os.environ.get("MIGRATION_TEST_POSTGRES_URL"), reason="optional disposable PostgreSQL database")
def test_disposable_postgres_fresh_and_existing_upgrade(monkeypatch):
    url = os.environ["MIGRATION_TEST_POSTGRES_URL"]
    engine = sa.create_engine(url)
    cfg = config(monkeypatch, url)
    command.upgrade(cfg, "head")
    assert_schema(engine)
    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO users (id,email) VALUES (91,'postgres@example.test')"))
        conn.execute(sa.text("INSERT INTO cases (id,user_id,title) VALUES (91,91,'Preserve postgres')"))
    # Simulate a stamped install missing one leaf table while retaining rows.
    with engine.begin() as conn:
        Base.metadata.tables["agent_steps"].drop(conn)
    command.stamp(cfg, "f6a2d94b8c75")
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.scalar(sa.text("SELECT title FROM cases WHERE id=91")) == "Preserve postgres"
    assert_schema(engine)
    engine.dispose()


def test_new_revision_is_additive_and_frozen():
    import ast

    source = (ROOT / "backend/database/migration_schema_20261126.py").read_text()
    tree = ast.parse(source)
    calls = [
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert set(calls) == {"get_bind", "create_table", "create_index", "f"}
    created = {
        node.args[0].value
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "create_table"
    }
    assert created == MISSING
    assert "backend.models" not in source


def test_alembic_environment_registers_all_model_modules():
    import ast

    tree = ast.parse((ROOT / "alembic/env.py").read_text())
    registered = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if node.module == "backend.models":
                registered.update(alias.name for alias in node.names)
            elif node.module.startswith("backend.models."):
                registered.add(node.module.rsplit(".", 1)[1])
    expected = {module.name for module in pkgutil.iter_modules(models.__path__)}
    assert expected <= registered
