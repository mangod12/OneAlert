"""
Compliance router for managing frameworks, controls, and assessments.

Provides endpoints for:
- Listing available compliance frameworks
- Listing controls per framework
- Running automated compliance assessments
- Manually updating assessment status
- Viewing compliance summary per framework
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.compliance import (
    ComplianceFramework,
    ComplianceControl,
    ComplianceAssessment,
    FrameworkResponse,
    ControlResponse,
    AssessmentResponse,
    AssessmentUpdate,
    ComplianceSummary,
)
from backend.routers.auth import get_active_user
from backend.services.compliance_engine import run_automated_assessment

router = APIRouter()


@router.get("/frameworks", response_model=List[FrameworkResponse])
async def list_frameworks(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all available compliance frameworks."""
    result = await db.execute(select(ComplianceFramework))
    frameworks = result.scalars().all()
    return frameworks


@router.get("/frameworks/{framework_id}/controls", response_model=List[ControlResponse])
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


@router.get("/summary", response_model=List[ComplianceSummary])
async def compliance_summary(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get compliance summary per framework for current user."""
    frameworks_result = await db.execute(select(ComplianceFramework))
    frameworks = frameworks_result.scalars().all()

    summaries = []
    for fw in frameworks:
        # Total controls in framework
        total_result = await db.execute(
            select(func.count(ComplianceControl.id)).where(
                ComplianceControl.framework_id == fw.id
            )
        )
        total_controls = total_result.scalar_one()

        # Get assessment counts per status for this user and framework
        compliant_count = await _count_by_status(db, current_user.id, fw.id, "compliant")
        non_compliant_count = await _count_by_status(db, current_user.id, fw.id, "non_compliant")
        partial_count = await _count_by_status(db, current_user.id, fw.id, "partial")

        assessed_count = compliant_count + non_compliant_count + partial_count
        not_assessed_count = total_controls - assessed_count

        compliance_pct = (
            round((compliant_count / total_controls) * 100, 1)
            if total_controls > 0
            else 0.0
        )

        summaries.append(ComplianceSummary(
            framework_id=fw.id,
            framework_name=fw.name,
            total_controls=total_controls,
            compliant=compliant_count,
            non_compliant=non_compliant_count,
            partial=partial_count,
            not_assessed=not_assessed_count,
            compliance_percentage=compliance_pct,
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


@router.patch("/assessments/{assessment_id}", response_model=AssessmentResponse)
async def update_assessment(
    assessment_id: int,
    update: AssessmentUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Manually update an assessment status."""
    assessment = await db.get(ComplianceAssessment, assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    valid_statuses = {"compliant", "non_compliant", "partial", "not_applicable", "not_assessed"}
    if update.status not in valid_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(valid_statuses))}"
        )

    assessment.status = update.status
    if update.evidence_type is not None:
        assessment.evidence_type = update.evidence_type
    if update.evidence_detail is not None:
        assessment.evidence_detail = update.evidence_detail
    assessment.assessed_by = current_user.email

    await db.commit()
    await db.refresh(assessment)
    return assessment


@router.get("/assessments", response_model=List[AssessmentResponse])
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


async def _count_by_status(
    db: AsyncSession, user_id: int, framework_id: int, status: str
) -> int:
    """Count assessments by status for a user within a framework."""
    result = await db.execute(
        select(func.count(ComplianceAssessment.id))
        .join(ComplianceControl, ComplianceAssessment.control_id == ComplianceControl.id)
        .where(
            ComplianceAssessment.user_id == user_id,
            ComplianceControl.framework_id == framework_id,
            ComplianceAssessment.status == status,
        )
    )
    return result.scalar_one()
