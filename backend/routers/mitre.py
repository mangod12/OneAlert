"""MITRE ATT&CK router — coverage, techniques, and mapping."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.case import Case
from backend.routers.auth import get_active_user
from backend.services.mitre.attack_data import (
    TACTICS, TECHNIQUES, get_tactic, get_technique, search_techniques, compute_coverage,
)

router = APIRouter()


@router.get("/tactics")
async def list_tactics():
    """List all MITRE ATT&CK tactics."""
    return [{"id": tid, **info} for tid, info in TACTICS.items()]


@router.get("/techniques")
async def list_techniques(
    search: str = Query(None, description="Search by keyword"),
    tactic: str = Query(None, description="Filter by tactic ID"),
):
    """List or search MITRE ATT&CK techniques."""
    if search:
        return search_techniques(search)

    results = []
    for tid, info in TECHNIQUES.items():
        if tactic and tactic not in info["tactics"]:
            continue
        results.append({"id": tid, **info})
    return results


@router.get("/coverage")
async def get_coverage(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get MITRE ATT&CK detection coverage based on user's cases."""
    result = await db.execute(
        select(Case.mitre_techniques)
        .where(Case.user_id == current_user.id, Case.mitre_techniques != None)
    )
    all_techniques = result.scalars().all()

    detected = set()
    for techniques_list in all_techniques:
        if isinstance(techniques_list, list):
            for t in techniques_list:
                if isinstance(t, dict):
                    detected.add(t.get("id", ""))
                elif isinstance(t, str):
                    detected.add(t)

    coverage = compute_coverage(detected)
    return {"success": True, "data": coverage}
