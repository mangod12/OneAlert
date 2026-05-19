"""Security events router — ingest, upload, list, and manage event sources."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.security_event import (
    SecurityEvent, EventSource, SecurityEventResponse,
    EventBatchIngest, EventListResponse, EventSourceResponse,
)
from backend.routers.auth import get_active_user

import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


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

    content = await file.read()
    text = content.decode("utf-8", errors="replace")

    # Parse as JSON array or newline-delimited JSON
    events = []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            events = parsed
        elif isinstance(parsed, dict):
            events = [parsed]
    except json.JSONDecodeError:
        # Try newline-delimited JSON
        for line in text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not events:
        raise HTTPException(status_code=400, detail="No valid JSON events found in file")

    if len(events) > 50000:
        raise HTTPException(status_code=400, detail="File size limit is 50,000 events")

    result = await ingest_events(
        db=db,
        user_id=current_user.id,
        raw_events=events,
        source_type=source_type,
        source_name=file.filename,
    )

    return {"success": True, "data": result}


@router.get("/", response_model=EventListResponse)
async def list_events(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    severity: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    source_ip: Optional[str] = Query(None),
    dest_ip: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
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
    if source_type:
        query = query.filter(SecurityEvent.source_type == source_type)
        count_q = count_q.filter(SecurityEvent.source_type == source_type)

    total = (await db.execute(count_q)).scalar_one()
    query = query.order_by(SecurityEvent.timestamp.desc()).offset(skip).limit(size)
    result = await db.execute(query)
    events = result.scalars().all()

    return EventListResponse(events=events, total=total, page=page, size=size)


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
    for event_type, count in type_result.all():
        by_type[event_type] = count

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
