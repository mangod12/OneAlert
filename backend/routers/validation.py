"""Validation router — purple-team validation runs, steps, and control results."""


import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import Integer, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.validation import (
    ControlResult,
    ControlResultResponse,
    ValidationRun,
    ValidationRunCreate,
    ValidationRunResponse,
    ValidationStep,
    ValidationStepResponse,
)
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get("/runs")
async def list_validation_runs(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List purple-team validation runs."""
    skip = (page - 1) * size
    query = select(ValidationRun).where(ValidationRun.user_id == current_user.id)
    count_q = select(func.count(ValidationRun.id)).where(ValidationRun.user_id == current_user.id)

    if status_filter:
        query = query.filter(ValidationRun.status == status_filter)
        count_q = count_q.filter(ValidationRun.status == status_filter)

    total = (await db.execute(count_q)).scalar_one()
    runs = (await db.execute(
        query.order_by(ValidationRun.created_at.desc()).offset(skip).limit(size)
    )).scalars().all()

    return {
        "success": True,
        "data": [ValidationRunResponse.model_validate(r) for r in runs],
        "total": total,
        "page": page,
        "size": size,
    }


@router.post("/runs", status_code=status.HTTP_201_CREATED)
async def create_validation_run(
    run_data: ValidationRunCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new validation run."""
    # Production mode blocked without explicit approval
    if run_data.mode == "production":
        raise HTTPException(
            status_code=403,
            detail="Production mode requires admin approval. Use 'dry_run' or 'lab' mode.",
        )

    vrun = ValidationRun(
        user_id=current_user.id,
        name=run_data.name,
        description=run_data.description,
        mode=run_data.mode,
        scope=run_data.scope,
        mitre_techniques=run_data.mitre_techniques,
    )
    db.add(vrun)
    await db.commit()
    await db.refresh(vrun)

    return {"success": True, "data": ValidationRunResponse.model_validate(vrun)}


async def _controls_by_step(db: AsyncSession, steps: list[ValidationStep]) -> dict[int, list[ControlResult]]:
    """Load controls once for the already owner-scoped run's steps."""
    grouped: dict[int, list[ControlResult]] = {}
    if not steps:
        return grouped
    controls = (await db.execute(
        select(ControlResult)
        .where(ControlResult.step_id.in_([step.id for step in steps]))
        .order_by(ControlResult.step_id, ControlResult.id)
    )).scalars().all()
    for control in controls:
        grouped.setdefault(control.step_id, []).append(control)
    return grouped


@router.get("/runs/{run_id}")
async def get_validation_run(
    run_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get validation run with steps and results."""
    vrun = (await db.execute(
        select(ValidationRun).where(
            ValidationRun.id == run_id,
            ValidationRun.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not vrun:
        raise HTTPException(status_code=404, detail="Validation run not found")

    steps = (await db.execute(
        select(ValidationStep)
        .where(ValidationStep.run_id == run_id)
        .order_by(ValidationStep.step_number)
    )).scalars().all()

    controls_by_step = await _controls_by_step(db, steps)
    step_responses = []
    for step in steps:
        controls = controls_by_step.get(step.id, [])

        step_data = ValidationStepResponse.model_validate(step).model_dump()
        step_data["controls"] = [ControlResultResponse.model_validate(c).model_dump() for c in controls]
        step_responses.append(step_data)

    run_data = ValidationRunResponse.model_validate(vrun).model_dump()
    run_data["steps"] = step_responses

    return {"success": True, "data": run_data}


@router.get("/runs/{run_id}/export")
async def export_validation_run(
    run_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export a validation run's steps and control results as CSV."""
    vrun = (await db.execute(
        select(ValidationRun).where(
            ValidationRun.id == run_id,
            ValidationRun.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not vrun:
        raise HTTPException(status_code=404, detail="Validation run not found")

    steps = (await db.execute(
        select(ValidationStep)
        .where(ValidationStep.run_id == run_id)
        .order_by(ValidationStep.step_number)
    )).scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "run", "mode", "run_status", "step_number", "technique_id",
        "technique_name", "test_name", "test_type", "step_status",
        "actual_result", "duration_ms", "controls", "executed_at",
    ])
    controls_by_step = await _controls_by_step(db, steps)
    for step in steps:
        controls = controls_by_step.get(step.id, [])
        control_summary = "; ".join(
            f"{c.control_name} ({'detected' if c.detected else 'missed'})"
            for c in controls
        )
        writer.writerow([
            vrun.name,
            vrun.mode,
            vrun.status,
            step.step_number,
            step.technique_id,
            step.technique_name,
            step.test_name,
            step.test_type or "",
            step.status,
            step.actual_result or "",
            step.duration_ms if step.duration_ms is not None else "",
            control_summary,
            step.executed_at.isoformat() if step.executed_at else "",
        ])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=validation-run-{run_id}.csv"},
    )


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_validation_run(
    run_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a validation run and its steps/results, owned by the current user."""
    vrun = (await db.execute(
        select(ValidationRun).where(
            ValidationRun.id == run_id,
            ValidationRun.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not vrun:
        raise HTTPException(status_code=404, detail="Validation run not found")

    # Delete dependents explicitly: async sessions cannot lazy-load for ORM cascades.
    step_ids = (await db.execute(
        select(ValidationStep.id).where(ValidationStep.run_id == run_id)
    )).scalars().all()
    if step_ids:
        await db.execute(delete(ControlResult).where(ControlResult.step_id.in_(step_ids)))
    await db.execute(delete(ValidationStep).where(ValidationStep.run_id == run_id))
    await db.delete(vrun)
    await db.commit()


@router.post("/runs/{run_id}/execute")
async def execute_validation_run(
    run_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Execute a validation run using the Purple-Team agent."""
    vrun = (await db.execute(
        select(ValidationRun).where(
            ValidationRun.id == run_id,
            ValidationRun.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not vrun:
        raise HTTPException(status_code=404, detail="Validation run not found")

    if vrun.status not in ("pending", "failed"):
        raise HTTPException(status_code=400, detail=f"Run status is '{vrun.status}', cannot execute")

    from backend.services.agents.purple import PurpleAgent
    agent = PurpleAgent(db=db, user_id=current_user.id)
    await agent.execute(
        run_id=run_id,
        techniques=vrun.mitre_techniques or [],
        mode=vrun.mode,
    )
    await db.refresh(vrun)

    return {
        "success": True,
        "data": {
            "run_id": run_id,
            "status": vrun.status,
            "results": vrun.results_summary or {},
            "summary": "Validation run completed",
        },
    }


@router.get("/coverage")
async def detection_coverage(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get detection coverage heatmap by MITRE technique."""
    # Aggregate control results across all runs
    results = await db.execute(
        select(
            ValidationStep.technique_id,
            ValidationStep.technique_name,
            func.count(ControlResult.id).label("total_tests"),
            func.sum(
                func.cast(ControlResult.detected, Integer)
            ).label("detections"),
        )
        .join(ControlResult, ControlResult.step_id == ValidationStep.id)
        .join(ValidationRun, ValidationRun.id == ValidationStep.run_id)
        .where(ValidationRun.user_id == current_user.id)
        .group_by(ValidationStep.technique_id, ValidationStep.technique_name)
    )

    coverage = []
    for row in results.all():
        total = row.total_tests or 0
        detected = row.detections or 0
        coverage.append({
            "technique_id": row.technique_id,
            "technique_name": row.technique_name,
            "total_tests": total,
            "detections": detected,
            "detection_rate": round(detected / total * 100, 1) if total > 0 else 0,
        })

    return {"success": True, "data": coverage}
