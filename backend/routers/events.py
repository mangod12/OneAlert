"""Security events router — ingest, upload, list, and manage event sources."""

import csv
import io
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import AwareDatetime
from sqlalchemy import case as sql_case
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.security_event import (
    EventBatchIngest,
    EventListResponse,
    EventSource,
    EventSourceResponse,
    SecurityEvent,
)
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.routers.event_evidence import router as evidence_router
from backend.routers.event_investigation import router as investigation_router
from backend.routers.event_recorded_neighbors import router as recorded_neighbors_router
from backend.routers.event_source_evidence import router as source_evidence_router

logger = logging.getLogger(__name__)

router = APIRouter()
router.include_router(evidence_router)
router.include_router(recorded_neighbors_router)
router.include_router(source_evidence_router)
router.include_router(investigation_router)

MAX_EVENT_UPLOAD_BYTES = 10 * 1024 * 1024
UPLOAD_READ_CHUNK_BYTES = 64 * 1024


async def _read_upload_with_limit(
    file: UploadFile,
    *,
    max_bytes: int = MAX_EVENT_UPLOAD_BYTES,
    chunk_size: int = UPLOAD_READ_CHUNK_BYTES,
) -> bytes:
    """Read an upload without ever buffering more than the configured cap."""
    chunks = []
    total = 0
    while chunk := await file.read(chunk_size):
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Uploaded file is too large",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/ingest", status_code=status.HTTP_201_CREATED)
async def ingest_events_webhook(
    batch: EventBatchIngest,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Webhook receiver — accept batch of events from log shippers (Filebeat, Fluentd, etc.)."""
    from backend.services.event_ingestion import ingest_events

    if not batch.events:
        raise HTTPException(status_code=400, detail="No events provided")

    if len(batch.events) > 10000:
        raise HTTPException(status_code=400, detail="Batch size limit is 10,000 events")

    result = await ingest_events(
        db=db,
        user_id=current_user.id,
        raw_events=batch.events,
        source_type=batch.source_type,
        source_name=batch.source_name,
    )

    return {"success": True, "data": result}


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_events_file(
    file: UploadFile = File(...),
    source_type: str = Query("suricata", description="Event source type"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Upload a file of events (EVE JSON, Zeek JSON logs).

    Accepts newline-delimited JSON or JSON array.
    """
    from backend.services.event_ingestion import ingest_events

    content = await _read_upload_with_limit(file)
    from backend.services.event_upload import parse_event_upload

    # Validate the whole envelope before creating a source or writing any rows.
    # Source-specific parsers still report ingested/skipped outcomes separately.
    events = parse_event_upload(content)

    result = await ingest_events(
        db=db,
        user_id=current_user.id,
        raw_events=events,
        source_type=source_type,
        source_name=file.filename,
    )

    return {"success": True, "data": result}


def _event_time_predicates(started_at: datetime | None, ended_before: datetime | None):
    if started_at and ended_before and started_at >= ended_before:
        raise HTTPException(status_code=422, detail="Start must be before the exclusive end time")
    predicates = []
    if started_at:
        predicates.append(SecurityEvent.timestamp >= started_at.astimezone(UTC))
    if ended_before:
        predicates.append(SecurityEvent.timestamp < ended_before.astimezone(UTC))
    return predicates


@router.get("/", response_model=EventListResponse)
async def list_events(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    severity: str | None = Query(None),
    event_type: str | None = Query(None),
    source_ip: str | None = Query(None),
    dest_ip: str | None = Query(None),
    source_type: str | None = Query(None),
    source_id: int | None = Query(None, ge=1),
    ip: str | None = Query(None, description="Substring match against source or destination IP"),
    signature: str | None = Query(None, description="Substring match against the event signature"),
    started_at: AwareDatetime | None = Query(None, description="Inclusive event timestamp, timezone required"),
    ended_before: AwareDatetime | None = Query(None, description="Exclusive event timestamp, timezone required"),
    sort: str = Query(
        "timestamp_desc",
        pattern="^(timestamp_desc|timestamp_asc|severity_desc|severity_asc)$",
        description="Sort order"
    ),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List security events with pagination and filters."""
    skip = (page - 1) * size

    query = select(SecurityEvent).where(SecurityEvent.user_id == current_user.id)
    count_q = select(func.count(SecurityEvent.id)).where(SecurityEvent.user_id == current_user.id)

    if severity:
        query = query.filter(SecurityEvent.severity == severity)
        count_q = count_q.filter(SecurityEvent.severity == severity)
    if event_type:
        query = query.filter(SecurityEvent.event_type == event_type)
        count_q = count_q.filter(SecurityEvent.event_type == event_type)
    if source_ip:
        query = query.filter(SecurityEvent.source_ip == source_ip)
        count_q = count_q.filter(SecurityEvent.source_ip == source_ip)
    if dest_ip:
        query = query.filter(SecurityEvent.dest_ip == dest_ip)
        count_q = count_q.filter(SecurityEvent.dest_ip == dest_ip)
    if source_id is not None:
        query = query.filter(SecurityEvent.source_id == source_id)
        count_q = count_q.filter(SecurityEvent.source_id == source_id)
    if source_type:
        query = query.filter(SecurityEvent.source_type == source_type)
        count_q = count_q.filter(SecurityEvent.source_type == source_type)
    if ip:
        ip_match = or_(
            SecurityEvent.source_ip.ilike(f"%{ip}%"),
            SecurityEvent.dest_ip.ilike(f"%{ip}%"),
        )
        query = query.filter(ip_match)
        count_q = count_q.filter(ip_match)
    if signature:
        sig_match = SecurityEvent.signature.ilike(f"%{signature}%")
        query = query.filter(sig_match)
        count_q = count_q.filter(sig_match)

    predicates = _event_time_predicates(started_at, ended_before)
    query = query.where(*predicates)
    count_q = count_q.where(*predicates)
    total = (await db.execute(count_q)).scalar_one()
    severity_rank = sql_case(
        {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0},
        value=SecurityEvent.severity,
        else_=2
    )
    order_columns = {
        "timestamp_desc": [SecurityEvent.timestamp.desc()],
        "timestamp_asc": [SecurityEvent.timestamp.asc()],
        "severity_desc": [severity_rank.desc(), SecurityEvent.timestamp.desc()],
        "severity_asc": [severity_rank.asc(), SecurityEvent.timestamp.desc()],
    }
    query = query.order_by(*order_columns[sort], SecurityEvent.id.desc()).offset(skip).limit(size)
    result = await db.execute(query)
    events = result.scalars().all()

    return EventListResponse(events=events, total=total, page=page, size=size)


@router.get("/export")
async def export_events(
    severity: str | None = Query(None),
    event_type: str | None = Query(None),
    source_ip: str | None = Query(None),
    dest_ip: str | None = Query(None),
    source_type: str | None = Query(None),
    source_id: int | None = Query(None, ge=1),
    ip: str | None = Query(None, description="Substring match against source or destination IP"),
    signature: str | None = Query(None, description="Substring match against the event signature"),
    started_at: AwareDatetime | None = Query(None, description="Inclusive event timestamp, timezone required"),
    ended_before: AwareDatetime | None = Query(None, description="Exclusive event timestamp, timezone required"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export every filtered event as CSV, or refuse above 10,000 matches."""
    query = select(SecurityEvent).where(SecurityEvent.user_id == current_user.id)

    if severity:
        query = query.filter(SecurityEvent.severity == severity)
    if event_type:
        query = query.filter(SecurityEvent.event_type == event_type)
    if source_ip:
        query = query.filter(SecurityEvent.source_ip == source_ip)
    if dest_ip:
        query = query.filter(SecurityEvent.dest_ip == dest_ip)
    if source_id is not None:
        query = query.filter(SecurityEvent.source_id == source_id)
    if source_type:
        query = query.filter(SecurityEvent.source_type == source_type)
    if ip:
        query = query.filter(or_(
            SecurityEvent.source_ip.ilike(f"%{ip}%"),
            SecurityEvent.dest_ip.ilike(f"%{ip}%"),
        ))
    if signature:
        query = query.filter(SecurityEvent.signature.ilike(f"%{signature}%"))

    query = query.where(*_event_time_predicates(started_at, ended_before))
    query = query.order_by(SecurityEvent.timestamp.desc(), SecurityEvent.id.desc()).limit(10001)
    rows = (await db.execute(query)).scalars().all()
    if len(rows) > 10000:
        raise HTTPException(status_code=422, detail=(
            "The filtered events export exceeds 10,000 records. Narrow the applied filters and retry. "
            "No partial CSV was created."
        ))

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "timestamp", "event_type", "severity", "signature", "category",
        "source_ip", "source_port", "dest_ip", "dest_port", "protocol", "action",
    ])
    # CSV quoting does not stop spreadsheet formula evaluation of telemetry.
    for event in rows:
        values = [
            event.id,
            event.timestamp.isoformat() if event.timestamp else "",
            event.event_type,
            event.severity,
            event.signature or "",
            event.category or "",
            event.source_ip or "",
            event.source_port if event.source_port is not None else "",
            event.dest_ip or "",
            event.dest_port if event.dest_port is not None else "",
            event.protocol or "",
            event.action or "",
        ]
        writer.writerow([
            "'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value
            for value in values
        ])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=events.csv"},
    )


@router.get("/sources", response_model=list[EventSourceResponse])
async def list_event_sources(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all event sources for the current user."""
    result = await db.execute(
        select(EventSource)
        .where(EventSource.user_id == current_user.id)
        .order_by(EventSource.last_event_at.desc().nullslast())
    )
    return result.scalars().all()


@router.get("/stats")
async def event_stats(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get event ingestion statistics."""
    total = (await db.execute(
        select(func.count(SecurityEvent.id)).where(SecurityEvent.user_id == current_user.id)
    )).scalar_one()

    by_severity = {}
    for sev in ["critical", "high", "medium", "low", "info"]:
        count = (await db.execute(
            select(func.count(SecurityEvent.id)).where(
                SecurityEvent.user_id == current_user.id,
                SecurityEvent.severity == sev,
            )
        )).scalar_one()
        by_severity[sev] = count

    by_type = {}
    type_result = await db.execute(
        select(SecurityEvent.event_type, func.count(SecurityEvent.id))
        .where(SecurityEvent.user_id == current_user.id)
        .group_by(SecurityEvent.event_type)
    )
    by_type = {event_type: count for event_type, count in type_result.all()}

    source_count = (await db.execute(
        select(func.count(EventSource.id)).where(EventSource.user_id == current_user.id)
    )).scalar_one()

    return {
        "success": True,
        "data": {
            "total_events": total,
            "by_severity": by_severity,
            "by_type": by_type,
            "source_count": source_count,
        },
    }
