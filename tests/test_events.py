"""Tests for security event ingestion, parsers, and API."""
import pytest
import pytest_asyncio
import json
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from backend.services.parsers.suricata import parse_suricata_eve
from backend.services.parsers.zeek import parse_zeek_log


# --- Suricata Parser Tests ---

class TestSuricataParser:
    def test_parse_alert(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00.000000+0000",
            "event_type": "alert",
            "src_ip": "10.0.0.5",
            "src_port": 54321,
            "dest_ip": "192.168.1.100",
            "dest_port": 502,
            "proto": "TCP",
            "alert": {
                "signature": "ET EXPLOIT Modbus TCP Function Code - Write Single Coil",
                "signature_id": 2024001,
                "severity": 1,
                "category": "Attempted Admin Privilege Gain",
                "action": "allowed",
            },
        }
        result = parse_suricata_eve(raw)
        assert result["event_type"] == "alert"
        assert result["severity"] == "critical"
        assert result["signature"] == "ET EXPLOIT Modbus TCP Function Code - Write Single Coil"
        assert result["source_ip"] == "10.0.0.5"
        assert result["dest_port"] == 502
        assert result["source_type"] == "suricata"

    def test_parse_dns(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "dns",
            "src_ip": "10.0.0.5",
            "dest_ip": "8.8.8.8",
            "dns": {"type": "query", "rrname": "evil.example.com"},
        }
        result = parse_suricata_eve(raw)
        assert result["domain"] == "evil.example.com"
        assert result["severity"] == "info"

    def test_parse_http(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "http",
            "src_ip": "10.0.0.5",
            "dest_ip": "93.184.216.34",
            "http": {"hostname": "example.com", "url": "/login", "http_method": "POST"},
        }
        result = parse_suricata_eve(raw)
        assert result["hostname"] == "example.com"
        assert result["url"] == "/login"

    def test_parse_flow(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "flow",
            "src_ip": "10.0.0.5",
            "dest_ip": "10.0.0.6",
            "flow": {"bytes_toclient": 1024, "bytes_toserver": 2048},
        }
        result = parse_suricata_eve(raw)
        assert result["bytes_in"] == 1024
        assert result["bytes_out"] == 2048

    def test_no_timestamp_returns_none(self):
        assert parse_suricata_eve({}) is None

    def test_tls_event(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "tls",
            "tls": {"sni": "badsite.com"},
        }
        result = parse_suricata_eve(raw)
        assert result["hostname"] == "badsite.com"
        assert result["category"] == "tls_handshake"


# --- Zeek Parser Tests ---

class TestZeekParser:
    def test_parse_conn(self):
        raw = {
            "_path": "conn",
            "ts": 1716192000.0,
            "id.orig_h": "10.0.0.5",
            "id.orig_p": 54321,
            "id.resp_h": "192.168.1.100",
            "id.resp_p": 80,
            "proto": "tcp",
            "orig_bytes": 500,
            "resp_bytes": 3000,
            "conn_state": "SF",
        }
        result = parse_zeek_log(raw)
        assert result["event_type"] == "conn"
        assert result["source_ip"] == "10.0.0.5"
        assert result["bytes_out"] == 500
        assert result["bytes_in"] == 3000
        assert result["source_type"] == "zeek"

    def test_parse_dns(self):
        raw = {
            "_path": "dns",
            "ts": 1716192000.0,
            "id.orig_h": "10.0.0.5",
            "id.resp_h": "8.8.8.8",
            "query": "c2.evil.com",
            "qtype_name": "A",
        }
        result = parse_zeek_log(raw)
        assert result["domain"] == "c2.evil.com"

    def test_parse_http(self):
        raw = {
            "_path": "http",
            "ts": 1716192000.0,
            "id.orig_h": "10.0.0.5",
            "id.resp_h": "93.184.216.34",
            "host": "example.com",
            "uri": "/api/exfil",
            "method": "POST",
            "user_agent": "curl/7.68",
        }
        result = parse_zeek_log(raw)
        assert result["hostname"] == "example.com"
        assert result["url"] == "/api/exfil"
        assert result["user_agent"] == "curl/7.68"

    def test_parse_notice(self):
        raw = {
            "_path": "notice",
            "ts": 1716192000.0,
            "note": "Scan::Port_Scan",
            "msg": "Port scan detected from 10.0.0.5",
        }
        result = parse_zeek_log(raw)
        assert result["severity"] == "high"
        assert result["signature"] == "Scan::Port_Scan"

    def test_parse_ssl(self):
        raw = {
            "_path": "ssl",
            "ts": 1716192000.0,
            "server_name": "secure.example.com",
        }
        result = parse_zeek_log(raw)
        assert result["hostname"] == "secure.example.com"
        assert result["category"] == "tls_handshake"

    def test_alt_field_names(self):
        """Zeek JSON can use _ instead of . in field names."""
        raw = {
            "_path": "conn",
            "ts": 1716192000.0,
            "id_orig_h": "10.0.0.1",
            "id_orig_p": 12345,
            "id_resp_h": "10.0.0.2",
            "id_resp_p": 443,
        }
        result = parse_zeek_log(raw)
        assert result["source_ip"] == "10.0.0.1"
        assert result["dest_ip"] == "10.0.0.2"


# --- API Integration Tests ---

class TestEventsAPI:
    """API tests using FastAPI test client.

    Note: These tests manage their own DB lifecycle and pass when run in isolation
    (pytest tests/test_events.py). When run in the full suite, earlier tests may
    pollute the cached DB engine. CI runs pytest per-file which avoids this.
    """

    @pytest_asyncio.fixture
    async def client_and_token(self):
        """Create test client with authenticated user."""
        import uuid
        db_name = f"test_events_{uuid.uuid4().hex[:8]}.db"
        os.environ["DATABASE_URL"] = f"sqlite:///{db_name}"
        os.environ["TESTING"] = "1"
        os.environ["DISABLE_SCHEDULER"] = "1"

        # Reset config + DB engine for test isolation
        import backend.config as config_mod
        config_mod.settings = config_mod.Settings()

        import backend.database.db as db_mod
        db_mod._engine = None
        db_mod._async_engine = None
        db_mod.SessionLocal = db_mod.get_session_local()
        db_mod.AsyncSessionLocal = db_mod.get_async_session_local()
        db_mod.engine = db_mod.get_engine()
        db_mod.async_engine = db_mod.get_async_engine()

        # Import all models so create_all picks them up
        import backend.models.user  # noqa: F401
        import backend.models.asset  # noqa: F401
        import backend.models.alert  # noqa: F401
        import backend.models.organization  # noqa: F401
        import backend.models.security_event  # noqa: F401

        from backend.database.db import get_async_engine, Base
        engine = get_async_engine()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        from backend.main import app
        return app

    @pytest.mark.asyncio
    async def test_ingest_webhook(self, client_and_token):
        from httpx import AsyncClient, ASGITransport
        app = client_and_token

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            # Register + login
            await ac.post("/api/v1/auth/register", json={
                "email": "events_test@test.com", "password": "testpass123",
                "full_name": "Test"
            })
            login = await ac.post("/api/v1/auth/login",
                data={"username": "events_test@test.com", "password": "testpass123"},
                headers={"Content-Type": "application/x-www-form-urlencoded"})
            token = login.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            # Ingest Suricata events
            resp = await ac.post("/api/v1/events/ingest", json={
                "source_type": "suricata",
                "events": [
                    {
                        "timestamp": "2026-05-20T10:00:00Z",
                        "event_type": "alert",
                        "src_ip": "10.0.0.5",
                        "dest_ip": "192.168.1.100",
                        "dest_port": 502,
                        "proto": "TCP",
                        "alert": {
                            "signature": "Modbus Write Coil",
                            "signature_id": 2024001,
                            "severity": 1,
                            "category": "OT Exploit",
                            "action": "allowed",
                        },
                    },
                    {
                        "timestamp": "2026-05-20T10:01:00Z",
                        "event_type": "dns",
                        "src_ip": "10.0.0.5",
                        "dest_ip": "8.8.8.8",
                        "dns": {"type": "query", "rrname": "c2.evil.com"},
                    },
                ],
            }, headers=headers)

            assert resp.status_code == 201
            data = resp.json()["data"]
            assert data["ingested"] == 2
            assert data["skipped"] == 0

            # List events
            resp = await ac.get("/api/v1/events/", headers=headers)
            assert resp.status_code == 200
            assert resp.json()["total"] >= 2

            # List sources
            resp = await ac.get("/api/v1/events/sources", headers=headers)
            assert resp.status_code == 200
            assert len(resp.json()) == 1

            # Stats
            resp = await ac.get("/api/v1/events/stats", headers=headers)
            assert resp.status_code == 200
            assert resp.json()["data"]["total_events"] == 2

    @pytest.mark.asyncio
    async def test_ingest_empty_batch_rejected(self, client_and_token):
        from httpx import AsyncClient, ASGITransport
        app = client_and_token

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            await ac.post("/api/v1/auth/register", json={
                "email": "events_empty@test.com", "password": "testpass123",
                "full_name": "Test"
            })
            login = await ac.post("/api/v1/auth/login",
                data={"username": "events_empty@test.com", "password": "testpass123"},
                headers={"Content-Type": "application/x-www-form-urlencoded"})
            token = login.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            resp = await ac.post("/api/v1/events/ingest", json={
                "source_type": "suricata",
                "events": [],
            }, headers=headers)
            assert resp.status_code == 400
