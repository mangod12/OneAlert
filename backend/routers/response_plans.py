"""Response plans router — approval workflow, plan lifecycle, action execution."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.response_plan import (
    ResponsePlan, ApprovalRequest, ResponsePlanResponse,
)
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get("/")
async def list_response_plans(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    case_id: Optional[int] = Query(None),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List response plans with pagination and filters."""
    skip = (page - 1) * size
    query = select(ResponsePlan).where(ResponsePlan.user_id == current_user.id)
    count_q = select(func.count(ResponsePlan.id)).where(ResponsePlan.user_id == current_user.id)

    if status_filter:
        query = query.filter(ResponsePlan.status == status_filter)
        count_q = count_q.filter(ResponsePlan.status == status_filter)
    if case_id:
        query = query.filter(ResponsePlan.case_id == case_id)
        count_q = count_q.filter(ResponsePlan.case_id == case_id)

    total = (await db.execute(count_q)).scalar_one()
    plans = (await db.execute(
        query.order_by(ResponsePlan.created_at.desc()).offset(skip).limit(size)
    )).scalars().all()

    return {
        "success": True,
        "data": [ResponsePlanResponse.model_validate(p) for p in plans],
        "total": total,
        "page": page,
        "size": size,
    }


@router.get("/pending-approvals")
async def list_pending_approvals(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all pending approval requests for the current user's plans."""
    result = await db.execute(
        select(ApprovalRequest, ResponsePlan)
        .join(ResponsePlan, ApprovalRequest.plan_id == ResponsePlan.id)
        .where(
            ResponsePlan.user_id == current_user.id,
            ApprovalRequest.status == "pending",
        )
        .order_by(ApprovalRequest.created_at.desc())
    )
    rows = result.all()

    approvals = []
    for approval, plan in rows:
        approvals.append({
            "id": approval.id,
            "plan_id": plan.id,
            "case_id": plan.case_id,
            "status": approval.status,
            "reason": approval.reason,
            "requested_by": approval.requested_by,
            "actions": plan.actions,
            "autonomy_level": plan.autonomy_level,
            "created_at": approval.created_at.isoformat(),
        })

    return {"success": True, "data": approvals, "total": len(approvals)}


@router.get("/{plan_id}", response_model=ResponsePlanResponse)
async def get_response_plan(
    plan_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get a specific response plan."""
    plan = (await db.execute(
        select(ResponsePlan).where(
            ResponsePlan.id == plan_id,
            ResponsePlan.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")
    return plan


@router.post("/{plan_id}/approve")
async def approve_plan(
    plan_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Approve a response plan and its pending approval requests."""
    plan = (await db.execute(
        select(ResponsePlan).where(
            ResponsePlan.id == plan_id,
            ResponsePlan.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")

    if plan.status not in ("pending_approval", "draft"):
        raise HTTPException(status_code=400, detail=f"Plan status is '{plan.status}', cannot approve")

    now = datetime.now(timezone.utc)
    plan.status = "approved"
    plan.approved_by = current_user.id
    plan.approved_at = now

    # Approve all pending approval requests
    approvals = (await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.plan_id == plan_id,
            ApprovalRequest.status == "pending",
        )
    )).scalars().all()

    for approval in approvals:
        approval.status = "approved"
        approval.reviewed_by = current_user.id
        approval.reviewed_at = now

    await db.commit()

    return {
        "success": True,
        "message": f"Plan {plan_id} approved",
        "plan_status": plan.status,
        "approvals_resolved": len(approvals),
    }


@router.post("/{plan_id}/reject")
async def reject_plan(
    plan_id: int,
    reason: str = Body("", embed=True),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Reject a response plan."""
    plan = (await db.execute(
        select(ResponsePlan).where(
            ResponsePlan.id == plan_id,
            ResponsePlan.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")

    if plan.status not in ("pending_approval", "draft"):
        raise HTTPException(status_code=400, detail=f"Plan status is '{plan.status}', cannot reject")

    now = datetime.now(timezone.utc)
    plan.status = "rejected"

    approvals = (await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.plan_id == plan_id,
            ApprovalRequest.status == "pending",
        )
    )).scalars().all()

    for approval in approvals:
        approval.status = "rejected"
        approval.reviewed_by = current_user.id
        approval.reviewed_at = now
        approval.reason = reason or approval.reason

    await db.commit()

    return {
        "success": True,
        "message": f"Plan {plan_id} rejected",
        "plan_status": plan.status,
    }


@router.post("/{plan_id}/execute")
async def execute_plan(
    plan_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Execute an approved response plan."""
    plan = (await db.execute(
        select(ResponsePlan).where(
            ResponsePlan.id == plan_id,
            ResponsePlan.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")

    if plan.status != "approved":
        raise HTTPException(
            status_code=400,
            detail=f"Plan must be approved before execution (current: '{plan.status}')",
        )

    from backend.services.action_executor import execute_response_plan
    result = await execute_response_plan(db=db, plan=plan)

    return {"success": True, "data": result}
