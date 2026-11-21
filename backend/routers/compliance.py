"""
Compliance router for managing frameworks, controls, and assessments.

Provides endpoints for:
- Listing available compliance frameworks
- Listing controls per framework
- Running automated compliance assessments
- Manually updating assessment status
- Viewing compliance summary per framework
"""


import csv
import hashlib
import hmac
import io
import json
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy import update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.compliance import (
    AssessmentResponse,
    AssessmentUpdate,
    ComplianceAssessment,
    ComplianceControl,
    ComplianceFramework,
    ComplianceSummary,
    ControlResponse,
    FrameworkResponse,
)
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.compliance_engine import run_automated_assessment

router = APIRouter()


@router.get("/frameworks", response_model=list[FrameworkResponse])
async def list_frameworks(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all available compliance frameworks."""
    result = await db.execute(select(ComplianceFramework))
    frameworks = result.scalars().all()
    return frameworks


@router.get("/frameworks/{framework_id}/controls", response_model=list[ControlResponse])
async def list_controls(
    framework_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all controls for a specific compliance framework."""
    # Verify framework exists
    fw = await db.get(ComplianceFramework, framework_id)
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")

    result = await db.execute(
        select(ComplianceControl).where(ComplianceControl.framework_id == framework_id)
    )
    controls = result.scalars().all()
    return controls


COMPLIANCE_EXPORT_LIMIT = 5000


@router.get("/export")
async def export_compliance(
    framework_id: int | None = Query(None, description="Limit the export to one framework"),
    query: str = Query("", max_length=200),
    status: Literal["", "compliant", "non_compliant", "partial", "not_applicable", "not_assessed"] = "",
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export controls with their latest assessment as CSV (max 5000 rows)."""
    controls_q = select(ComplianceControl)
    if framework_id is not None:
        controls_q = controls_q.where(ComplianceControl.framework_id == framework_id)
    if query.strip():
        needle = query.strip().lower()
        controls_q = controls_q.where(or_(
            func.lower(ComplianceControl.control_id).contains(needle, autoescape=True),
            func.lower(ComplianceControl.title).contains(needle, autoescape=True),
        ))
    if status:
        ranked = select(
            ComplianceAssessment.control_id, ComplianceAssessment.status,
            func.row_number().over(partition_by=ComplianceAssessment.control_id, order_by=(
                ComplianceAssessment.assessed_at.desc().nulls_last(), ComplianceAssessment.id.desc()
            )).label("rank"),
        ).where(ComplianceAssessment.user_id == current_user.id).subquery()
        current = select(ranked.c.control_id, ranked.c.status).where(ranked.c.rank == 1).subquery()
        controls_q = controls_q.outerjoin(current, current.c.control_id == ComplianceControl.id).where(
            func.coalesce(current.c.status, "not_assessed") == status)
    controls = (await db.execute(
        controls_q.order_by(ComplianceControl.id).limit(COMPLIANCE_EXPORT_LIMIT + 1)
    )).scalars().all()
    if len(controls) > COMPLIANCE_EXPORT_LIMIT:
        raise HTTPException(status_code=422, detail=f"More than {COMPLIANCE_EXPORT_LIMIT} controls match. "
                            "Narrow the framework, search or status. No partial CSV was created.")

    frameworks = {
        f.id: f
        for f in (await db.execute(select(ComplianceFramework))).scalars().all()
    }

    latest = await _latest_assessments(db, current_user.id)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "framework", "framework_version", "control_id", "title", "category",
        "status", "evidence_type", "evidence_detail", "assessed_by", "assessed_at",
    ])
    def spreadsheet_text(value):
        # Quoting CSV cells does not prevent spreadsheet formula interpretation.
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    for control in controls:
        assessment = latest.get(control.id)
        framework = frameworks.get(control.framework_id)
        writer.writerow([spreadsheet_text(value) for value in [
            framework.name if framework else "",
            framework.version if framework else "",
            control.control_id,
            control.title,
            control.category or "",
            assessment.status if assessment else "not_assessed",
            (assessment.evidence_type or "") if assessment else "",
            (assessment.evidence_detail or "") if assessment else "",
            assessment.assessed_by if assessment else "",
            assessment.assessed_at.isoformat() if assessment and assessment.assessed_at else "",
        ]])
    buffer.seek(0)
    filename = f"compliance-{framework_id}.csv" if framework_id is not None else "compliance.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/summary", response_model=list[ComplianceSummary])
async def compliance_summary(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get compliance summary per framework for current user."""
    frameworks_result = await db.execute(select(ComplianceFramework))
    frameworks = frameworks_result.scalars().all()

    controls = (await db.execute(select(ComplianceControl))).scalars().all()
    latest = await _latest_assessments(db, current_user.id)
    counts_by_framework = {fw.id: {status: 0 for status in (
        "compliant", "non_compliant", "partial", "not_applicable", "not_assessed"
    )} for fw in frameworks}
    totals = {fw.id: 0 for fw in frameworks}
    for control in controls:
        if control.framework_id not in totals:
            continue
        totals[control.framework_id] += 1
        assessment = latest.get(control.id)
        status = assessment.status if assessment else "not_assessed"
        counts = counts_by_framework[control.framework_id]
        counts[status if status in counts else "not_assessed"] += 1

    summaries = []
    for fw in frameworks:
        counts = counts_by_framework[fw.id]
        total = totals[fw.id]
        summaries.append(ComplianceSummary(
            framework_id=fw.id,
            framework_name=fw.name,
            total_controls=total,
            **counts,
            compliance_percentage=round(counts["compliant"] / total * 100, 1) if total else 0.0,
        ))

    return summaries


@router.post("/assess")
async def run_assessment(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Run automated compliance assessment for current user."""
    results = await run_automated_assessment(current_user.id, db)
    return {
        "success": True,
        "data": {"assessments": results, "total": len(results)},
        "error": None,
        "metadata": {"user_id": current_user.id},
    }


@router.post("/controls/{control_id}/assessments", response_model=AssessmentResponse, status_code=201)
async def create_manual_assessment(
    control_id: int,
    payload: AssessmentUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Record a manual review without running automated checks or altering history."""
    control = await db.get(ComplianceControl, control_id)
    if control is None:
        raise HTTPException(status_code=404, detail="Control not found")
    _validate_assessment(payload)
    assessment = ComplianceAssessment(
        user_id=current_user.id,
        control_id=control_id,
        status=payload.status,
        evidence_type=payload.evidence_type,
        evidence_detail=payload.evidence_detail,
        assessed_by=current_user.email,
        assessed_at=datetime.now(UTC),
    )
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)
    return assessment


@router.patch("/assessments/{assessment_id}", response_model=AssessmentResponse)
async def update_assessment(
    assessment_id: int,
    update: AssessmentUpdate,
    reviewed_fingerprint: str | None = Query(None, min_length=64, max_length=64, pattern="^[a-f0-9]{64}$"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Manually update an assessment status."""
    assessment = (await db.execute(select(ComplianceAssessment).where(
        ComplianceAssessment.id == assessment_id,
    ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    _validate_assessment(update)

    if reviewed_fingerprint is not None:
        if not hmac.compare_digest(reviewed_fingerprint, _assessment_fingerprint(assessment)):
            raise HTTPException(status_code=409, detail="Assessment changed. Reload the review before saving.")
        predicates = []
        for key, value in _assessment_values(assessment).items():
            column = getattr(ComplianceAssessment, key)
            # SQLite CURRENT_TIMESTAMP defaults omit fractional seconds. Match
            # that representation too, without dropping the reviewed timestamp.
            if key == "assessed_at" and value is not None:
                predicates.append(or_(column == value, cast(column, String) == str(value)))
            else:
                predicates.append(column.is_(None) if value is None else column == value)
        values = {"status": update.status, "assessed_by": current_user.email}
        for key in ("evidence_type", "evidence_detail"):
            if key in update.model_fields_set:
                values[key] = getattr(update, key)
        result = await db.execute(sql_update(ComplianceAssessment).where(*predicates).values(**values)
                                  .execution_options(synchronize_session=False))
        if result.rowcount != 1:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Assessment changed. Reload the review before saving.")
        await db.commit()
        await db.refresh(assessment)
        return assessment

    assessment.status = update.status
    if "evidence_type" in update.model_fields_set:
        assessment.evidence_type = update.evidence_type
    if "evidence_detail" in update.model_fields_set:
        assessment.evidence_detail = update.evidence_detail
    assessment.assessed_by = current_user.email

    await db.commit()
    await db.refresh(assessment)
    return assessment


@router.get("/assessments", response_model=list[AssessmentResponse])
async def list_assessments(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all assessments for current user."""
    result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.user_id == current_user.id
        )
    )
    assessments = result.scalars().all()
    return assessments


@router.get("/assessments/{assessment_id}", response_model=AssessmentResponse)
async def get_assessment(
    assessment_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read one current owned assessment; not a historical version of an edited record."""
    assessment = (await db.execute(select(ComplianceAssessment).where(
        ComplianceAssessment.id == assessment_id,
        ComplianceAssessment.user_id == current_user.id,
    ))).scalar_one_or_none()
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return assessment



def _assessment_values(assessment: ComplianceAssessment) -> dict:
    return {key: getattr(assessment, key) for key in (
        "id", "user_id", "control_id", "status", "evidence_type", "evidence_detail", "assessed_at", "assessed_by"
    )}


def _assessment_fingerprint(assessment: ComplianceAssessment) -> str:
    return hashlib.sha256(json.dumps(_assessment_values(assessment), sort_keys=True, default=str).encode()).hexdigest()


@router.get("/assessments/{assessment_id}/review")
async def review_assessment(
    assessment_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read one owned saved record for a guarded edit, without creating an assessment."""
    assessment = (await db.execute(select(ComplianceAssessment).where(
        ComplianceAssessment.id == assessment_id,
        ComplianceAssessment.user_id == current_user.id,
    ))).scalar_one_or_none()
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return {"assessment": AssessmentResponse.model_validate(assessment),
            "reviewed_fingerprint": _assessment_fingerprint(assessment)}

def _validate_assessment(update: AssessmentUpdate) -> None:
    valid_statuses = {"compliant", "non_compliant", "partial", "not_applicable", "not_assessed"}
    if update.status not in valid_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(valid_statuses))}"
        )

    valid_evidence_types = {"automated", "manual", "document"}
    if update.evidence_type is not None and update.evidence_type not in valid_evidence_types:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid evidence_type. Must be one of: {', '.join(sorted(valid_evidence_types))}"
        )


async def _latest_assessments(
    db: AsyncSession, user_id: int
) -> dict[int, ComplianceAssessment]:
    """Use one deterministic latest row per control for posture and export."""
    result = await db.execute(
        select(ComplianceAssessment)
        .where(ComplianceAssessment.user_id == user_id)
        .order_by(
            ComplianceAssessment.assessed_at.desc().nulls_last(),
            ComplianceAssessment.id.desc(),
        )
    )
    latest: dict[int, ComplianceAssessment] = {}
    for assessment in result.scalars():
        latest.setdefault(assessment.control_id, assessment)
    return latest
