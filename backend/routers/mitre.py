"""MITRE ATT&CK router — coverage, techniques, and mapping."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import Case
from backend.models.detection_rule import DetectionRule
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.mitre.attack_data import (
    TACTICS,
    TECHNIQUES,
    compute_coverage,
    search_techniques,
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


def _technique_matches(techniques_list: object, technique_id: str) -> bool:
    """True when a stored mitre_techniques JSON list mentions the technique."""
    if not isinstance(techniques_list, list):
        return False
    for entry in techniques_list:
        if isinstance(entry, dict) and entry.get("id") == technique_id:
            return True
        if isinstance(entry, str) and entry == technique_id:
            return True
    return False


@router.get("/techniques/{technique_id}/references")
async def get_technique_references(
    technique_id: str,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List the cases and detection rules that reference a technique."""
    technique_id = technique_id.upper()
    technique = TECHNIQUES.get(technique_id)
    if technique is None:
        raise HTTPException(status_code=404, detail="Unknown technique")

    case_rows = await db.execute(
        select(Case.id, Case.title, Case.status, Case.mitre_techniques)
        .where(Case.user_id == current_user.id, Case.mitre_techniques.isnot(None))
        .order_by(Case.created_at.desc())
    )
    cases = [
        {"id": row.id, "title": row.title, "status": row.status}
        for row in case_rows.all()
        if _technique_matches(row.mitre_techniques, technique_id)
    ][:20]

    rule_rows = await db.execute(
        select(DetectionRule.id, DetectionRule.name, DetectionRule.enabled, DetectionRule.mitre_techniques)
        .where(DetectionRule.user_id == current_user.id, DetectionRule.mitre_techniques.isnot(None))
        .order_by(DetectionRule.created_at.desc())
    )
    rules = [
        {"id": row.id, "name": row.name, "enabled": row.enabled}
        for row in rule_rows.all()
        if _technique_matches(row.mitre_techniques, technique_id)
    ][:20]

    return {
        "technique_id": technique_id,
        "technique_name": technique["name"],
        "cases": cases,
        "detection_rules": rules,
    }


@router.get("/coverage")
async def get_coverage(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get MITRE ATT&CK detection coverage from the user's cases and enabled detection rules."""
    result = await db.execute(
        select(Case.mitre_techniques)
        .where(Case.user_id == current_user.id, Case.mitre_techniques.isnot(None))
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

    # Enabled detection rules are coverage too: each one watches for its techniques.
    rule_rows = await db.execute(
        select(DetectionRule.mitre_techniques)
        .where(
            DetectionRule.user_id == current_user.id,
            DetectionRule.enabled.is_(True),
            DetectionRule.mitre_techniques.isnot(None),
        )
    )
    for techniques_list in rule_rows.scalars().all():
        if isinstance(techniques_list, list):
            for t in techniques_list:
                if isinstance(t, dict):
                    detected.add(t.get("id", ""))
                elif isinstance(t, str):
                    detected.add(t)

    detected.discard("")
    coverage = compute_coverage(detected)
    return {"success": True, "data": coverage}
