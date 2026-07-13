"""Focused regression tests for outbound requests and ingestion boundaries."""

from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException, UploadFile


@pytest.mark.asyncio
async def test_outbound_url_requires_https():
    from backend.services.integrations.base import validate_outbound_url

    with pytest.raises(ValueError, match="HTTPS"):
        await validate_outbound_url("http://example.com")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "169.254.169.254",
        "224.0.0.1",
        "192.0.2.1",
        "::1",
        "fe80::1",
    ],
)
async def test_outbound_url_rejects_non_public_dns_results(address):
    from backend.services.integrations.base import validate_outbound_url

    family = 10 if ":" in address else 2
    resolved = [(family, 1, 6, "", (address, 443))]
    with patch("backend.services.integrations.base.socket.getaddrinfo", return_value=resolved):
        with pytest.raises(ValueError, match="public"):
            await validate_outbound_url("https://integration.example.com")


@pytest.mark.asyncio
async def test_outbound_url_accepts_only_public_dns_results():
    from backend.services.integrations.base import validate_outbound_url

    resolved = [(2, 1, 6, "", ("93.184.216.34", 443))]
    with patch("backend.services.integrations.base.socket.getaddrinfo", return_value=resolved):
        assert await validate_outbound_url("https://integration.example.com") == (
            "https://integration.example.com"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("integration_type", "config"),
    [
        ("splunk", {"hec_url": "http://splunk.example.com"}),
        ("servicenow", {"instance_url": "http://tenant.service-now.com"}),
    ],
)
async def test_integration_config_rejects_non_https_endpoint(integration_type, config):
    from backend.routers.integrations import validate_integration_config

    with pytest.raises(ValueError, match="HTTPS"):
        await validate_integration_config(integration_type, config)


@pytest.mark.asyncio
async def test_splunk_enables_tls_verification():
    from backend.services.integrations.splunk import SplunkIntegration

    response = httpx.Response(200, json={"text": "Success", "code": 0})
    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=client)
    context.__aexit__ = AsyncMock(return_value=None)

    with (
        patch(
            "backend.services.integrations.splunk.validate_outbound_url",
            new=AsyncMock(return_value="https://splunk.example.com:8088"),
        ),
        patch("backend.services.integrations.splunk.httpx.AsyncClient", return_value=context) as factory,
    ):
        result = await SplunkIntegration(
            {"hec_url": "https://splunk.example.com:8088", "hec_token": "token"}
        ).send_alert({"title": "test"})

    assert result["success"] is True
    assert factory.call_args.kwargs["verify"] is True


@pytest.mark.asyncio
async def test_integration_exception_is_not_returned_to_client():
    from backend.services.integrations.splunk import SplunkIntegration

    secret_error = "connection failed for /internal/path?token=super-secret"
    with (
        patch(
            "backend.services.integrations.splunk.validate_outbound_url",
            new=AsyncMock(return_value="https://splunk.example.com:8088"),
        ),
        patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=RuntimeError(secret_error))),
    ):
        result = await SplunkIntegration(
            {"hec_url": "https://splunk.example.com:8088", "hec_token": "token"}
        ).send_alert({"title": "test"})

    assert result == {"success": False, "error": "Integration request failed"}
    assert "super-secret" not in result["error"]


@pytest.mark.asyncio
async def test_upload_reader_enforces_cap_before_buffering_excess_bytes():
    from backend.routers.events import _read_upload_with_limit

    upload = UploadFile(filename="events.json", file=BytesIO(b"a" * 11))
    with pytest.raises(HTTPException) as exc_info:
        await _read_upload_with_limit(upload, max_bytes=10, chunk_size=4)

    assert exc_info.value.status_code == 413
    assert exc_info.value.detail == "Uploaded file is too large"


@pytest.mark.asyncio
async def test_upload_reader_accepts_exact_byte_cap():
    from backend.routers.events import _read_upload_with_limit

    content = b"a" * 10
    upload = UploadFile(filename="events.json", file=BytesIO(content))

    assert await _read_upload_with_limit(upload, max_bytes=10, chunk_size=4) == content


@pytest.mark.asyncio
async def test_sensor_ingestion_exception_is_not_returned_to_client():
    from backend.routers.sensor_ingest import ingest_single_device

    current_user = MagicMock(id=42)
    with patch(
        "backend.routers.sensor_ingest._process_ingested_device",
        new=AsyncMock(side_effect=RuntimeError("database password super-secret")),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await ingest_single_device(
                {"ip_address": "192.0.2.1"}, current_user=current_user, db=AsyncMock()
            )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Unable to ingest device"
    assert "super-secret" not in exc_info.value.detail


@pytest.mark.asyncio
async def test_sensor_batch_exception_is_not_returned_to_client():
    from backend.routers.sensor_ingest import ingest_sensor_batch

    current_user = MagicMock(id=42)
    database = AsyncMock()
    database.execute.side_effect = RuntimeError("database password super-secret")

    with pytest.raises(HTTPException) as exc_info:
        await ingest_sensor_batch(
            {"sensor_id": 7, "devices": [{"ip_address": "192.0.2.1"}]},
            current_user=current_user,
            db=database,
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Unable to ingest sensor batch"
    assert "super-secret" not in exc_info.value.detail
