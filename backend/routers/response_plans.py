"""Response plans router — approval workflow, plan lifecycle, action execution."""

import csv
import io
import secrets
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from sqlalchemy import String, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.response_plan import (
    ApprovalRequest,
    ResponsePlan,
    ResponsePlanResponse,
)
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.audit import add_audit_log
from backend.services.csv_export import spreadsheet_safe_row
from backend.services.response_review import deletion_fingerprint, review_fingerprint

router = APIRouter()


def _plan_scope(user_id, status_filter, case_id, query, autonomy_level):
    filters = [ResponsePlan.user_id == user_id]
    if status_filter:
        filters.append(ResponsePlan.status == status_filter)
    if case_id is not None:
        filters.append(ResponsePlan.case_id == case_id)
    if autonomy_level is not None:
        filters.append(ResponsePlan.autonomy_level == autonomy_level)
    if query.strip():
        filters.append(or_(*[
            func.lower(func.coalesce(cast(column, String), "")).contains(query.strip().lower(), autoescape=True)
            for column in (ResponsePlan.id, ResponsePlan.case_id, ResponsePlan.created_by)
        ]))
    return filters


def _plan_order(sort):
    return ([ResponsePlan.created_at.asc(), ResponsePlan.id.asc()] if sort == "oldest" else
            [ResponsePlan.created_at.desc(), ResponsePlan.id.desc()])


@router.get("/")
async def list_response_plans(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    case_id: int | None = Query(None, ge=1),
    query: str = Query("", max_length=200),
    autonomy_level: Literal["L0", "L1", "L2", "L3", "L4"] | None = None,
    sort: Literal["newest", "oldest"] = "newest",
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List response plans with pagination and filters."""
    skip = (page - 1) * size
    filters = _plan_scope(current_user.id, status_filter, case_id, query, autonomy_level)
    statement = select(ResponsePlan).where(*filters)
    count_q = select(func.count(ResponsePlan.id)).where(*filters)

    total = (await db.execute(count_q)).scalar_one()
    plans = (await db.execute(
        statement.order_by(*_plan_order(sort)).offset(skip).limit(size)
    )).scalars().all()

    return {
        "success": True,
        "data": [ResponsePlanResponse.model_validate(p) for p in plans],
        "total": total,
        "page": page,
        "size": size,
    }


@router.get("/export")
async def export_response_plans(
    status_filter: str | None = Query(None, alias="status"),
    case_id: int | None = Query(None, ge=1),
    query: str = Query("", max_length=200),
    autonomy_level: Literal["L0", "L1", "L2", "L3", "L4"] | None = None,
    sort: Literal["newest", "oldest"] = "newest",
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export the user's response plans as CSV, honoring list filters."""
    filters = _plan_scope(current_user.id, status_filter, case_id, query, autonomy_level)
    plans = (await db.execute(select(ResponsePlan).where(*filters).order_by(*_plan_order(sort)))).scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "case_id", "status", "autonomy_level", "created_by",
        "action_count", "approved_by", "approved_at", "created_at",
    ])
    for plan in plans:
        writer.writerow(spreadsheet_safe_row([
            plan.id,
            plan.case_id,
            plan.status,
            plan.autonomy_level,
            plan.created_by,
            len(plan.actions or []),
            plan.approved_by if plan.approved_by is not None else "",
            plan.approved_at.isoformat() if plan.approved_at else "",
            plan.created_at.isoformat() if plan.created_at else "",
        ]))
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=response-plans.csv"},
    )


@router.get("/pending-approvals")
async def list_pending_approvals(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    query: str = Query("", max_length=200),
    case_id: int | None = Query(None, ge=1),
    autonomy_level: Literal["L0", "L1", "L2", "L3", "L4"] | None = None,
    sort: Literal["newest", "oldest"] = "newest",
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Search all pending requests for the caller's plans, not just a loaded page."""
    statement = (select(ApprovalRequest, ResponsePlan)
                 .join(ResponsePlan, ApprovalRequest.plan_id == ResponsePlan.id)
                 .where(ResponsePlan.user_id == current_user.id, ApprovalRequest.status == "pending"))
    if query.strip():
        needle = query.strip().lower()
        statement = statement.where(or_(*[
            func.lower(func.coalesce(cast(column, String), "")).contains(needle, autoescape=True)
            for column in (ApprovalRequest.reason, ApprovalRequest.requested_by,
                           ApprovalRequest.id, ResponsePlan.id, ResponsePlan.case_id)
        ]))
    if case_id is not None:
        statement = statement.where(ResponsePlan.case_id == case_id)
    if autonomy_level is not None:
        statement = statement.where(ResponsePlan.autonomy_level == autonomy_level)
    total = (await db.execute(select(func.count()).select_from(statement.subquery()))).scalar_one()
    order = [ApprovalRequest.created_at.asc(), ApprovalRequest.id.asc()] if sort == "oldest" else [
        ApprovalRequest.created_at.desc(), ApprovalRequest.id.desc()]
    rows = (await db.execute(statement.order_by(*order).offset((page - 1) * size).limit(size))).all()

    approvals = []
    for approval, plan in rows:
        approvals.append({
            "id": approval.id,
            "plan_id": plan.id,
            "case_id": plan.case_id,
            "status": approval.status,
            "reason": approval.reason,
            "requested_by": approval.requested_by,
            "plan_status": plan.status,
            "actions": plan.actions,
            "review_fingerprint": review_fingerprint(plan),
            "autonomy_level": plan.autonomy_level,
            "created_at": approval.created_at.isoformat(),
        })

    return {"success": True, "data": approvals, "total": total, "page": page, "size": size}


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


@router.get("/{plan_id}/simulation-preflight")
async def read_simulation_preflight(
    plan_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Inspect saved action shapes and local simulation handlers without running them."""
    from backend.services.response_preflight import simulation_preflight
    plan = (await db.execute(select(ResponsePlan).where(
        ResponsePlan.id == plan_id, ResponsePlan.user_id == current_user.id,
    ))).scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Response plan not found")
    if isinstance(plan.actions, list) and len(plan.actions) > 5000:
        raise HTTPException(status_code=422, detail="This saved plan exceeds the 5,000-action preflight limit. "
                            "No partial preflight was created.")
    return {"plan_id": plan.id, "case_id": plan.case_id, "status": plan.status,
            "execution_mode": "simulated", "retrieved_at": datetime.now(UTC).isoformat(),
            **simulation_preflight(plan),
            "limitations": ["Read-only review of the saved plan and current local handler registry.",
                            "No handler, network request, approval or execution was performed.",
                            "A supported handler is a simulation, not a configured live integration.",
                            "Recorded policy flags are not a fresh policy check or permission.",
                            "This does not validate target ownership, safety, reachability or rollback readiness.",
                            "Order is shown only for well-formed actions with finite numeric priorities."]}


@router.get("/{plan_id}/approval-review")
async def get_approval_review(
    plan_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read exact owned plan evidence and its content fingerprint, without approving it."""
    plan = (await db.execute(select(ResponsePlan).where(
        ResponsePlan.id == plan_id, ResponsePlan.user_id == current_user.id,
    ))).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")
    return {"plan": ResponsePlanResponse.model_validate(plan), "review_fingerprint": review_fingerprint(plan)}


@router.post("/{plan_id}/approve")
async def approve_plan(
    plan_id: int,
    reviewed_fingerprint: str = Body(..., embed=True, min_length=64, max_length=64, pattern="^[a-f0-9]{64}$"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Approve a response plan and its pending approval requests."""
    plan = (await db.execute(
        select(ResponsePlan).where(
            ResponsePlan.id == plan_id,
            ResponsePlan.user_id == current_user.id,
        ).with_for_update()
    )).scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")

    if plan.status not in ("pending_approval", "draft"):
        raise HTTPException(status_code=400, detail=f"Plan status is '{plan.status}', cannot approve")

    if not secrets.compare_digest(reviewed_fingerprint, review_fingerprint(plan)):
        raise HTTPException(status_code=409, detail="The saved plan changed after review. Refresh and review it again.")
    if not plan.actions or not all(isinstance(action, dict) for action in plan.actions):
        raise HTTPException(status_code=400, detail="A plan requires saved action evidence before approval")

    now = datetime.now(UTC)
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

    add_audit_log(
        db,
        user_id=current_user.id,
        action="response_plan_approved",
        target_type="response_plan",
        target_id=plan.id,
        detail=(f"Plan approved; {len(approvals)} approval request(s) resolved; "
                f"reviewed fingerprint {reviewed_fingerprint}"),
    )
    await db.commit()

    return {
        "success": True,
        "message": f"Plan {plan_id} approved",
        "plan_status": plan.status,
        "approvals_resolved": len(approvals),
    }


class ReviewedPlanRejection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewed_fingerprint: StrictStr = Field(min_length=64, max_length=64, pattern="^[a-f0-9]{64}$")
    reason: StrictStr = Field(max_length=2000)


@router.post("/{plan_id}/reject-reviewed")
async def reject_reviewed_plan(
    plan_id: int, payload: ReviewedPlanRejection,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    return await _reject_owned_plan(plan_id, payload.reason, current_user, db, payload.reviewed_fingerprint)


@router.post("/{plan_id}/reject")
async def reject_plan(
    plan_id: int, reason: str = Body("", embed=True),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    return await _reject_owned_plan(plan_id, reason, current_user, db)


async def _reject_owned_plan(plan_id, reason, current_user, db, reviewed_fingerprint=None):
    """Reject a response plan."""
    plan = (await db.execute(
        select(ResponsePlan).where(
            ResponsePlan.id == plan_id,
            ResponsePlan.user_id == current_user.id,
        ).with_for_update()
    )).scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")

    if plan.status not in ("pending_approval", "draft"):
        raise HTTPException(status_code=400, detail=f"Plan status is '{plan.status}', cannot reject")

    if reviewed_fingerprint is not None and not secrets.compare_digest(reviewed_fingerprint, review_fingerprint(plan)):
        raise HTTPException(status_code=409, detail=(
            "The saved plan changed after rejection review. Refresh and review it again."))

    now = datetime.now(UTC)
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

    add_audit_log(
        db,
        user_id=current_user.id,
        action="response_plan_rejected",
        target_type="response_plan",
        target_id=plan.id,
        detail=("Plan rejected" + (f": {reason[:200]}" if reason else "")
                + (f"; reviewed fingerprint {reviewed_fingerprint}" if reviewed_fingerprint else "")),
    )
    await db.commit()

    return {
        "success": True,
        "message": f"Plan {plan_id} rejected",
        "plan_status": plan.status,
        "plan_id": plan.id,
        "case_id": plan.case_id,
        "approvals_resolved": len(approvals),
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
        ).with_for_update()
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

    public_results = [{
        "action": action_result.get("action", "unknown"),
        "target": action_result.get("target", "unknown"),
        "status": action_result.get("status", "unknown"),
        "detail": action_result.get("detail", ""),
        "executed_at": action_result.get("executed_at"),
        "execution_mode": action_result.get("execution_mode", "unknown"),
    } for action_result in result.get("results", [])]

    add_audit_log(
        db,
        user_id=current_user.id,
        action="response_plan_executed",
        target_type="response_plan",
        target_id=result.get("plan_id", plan_id),
        detail=(
            f"Plan run ({result.get('execution_mode', 'unknown')}): {result.get('succeeded', 0)} of "
            f"{result.get('total_actions', 0)} action(s) succeeded"
        ),
    )
    await db.commit()

    return {
        "success": True,
        "data": {
            "plan_id": result.get("plan_id", plan_id),
            "execution_mode": result.get("execution_mode", "unknown"),
            "status": result.get("status", "unknown"),
            "total_actions": result.get("total_actions", 0),
            "succeeded": result.get("succeeded", 0),
            "failed": result.get("failed", 0),
            "results": public_results,
        },
    }
class ReviewedPlanDeletion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewed_fingerprint: StrictStr = Field(min_length=64, max_length=64, pattern="^[a-f0-9]{64}$")


@router.get("/{plan_id}/deletion-review")
async def get_plan_deletion_review(
    plan_id: int, current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    plan = (await db.execute(select(ResponsePlan).where(
        ResponsePlan.id == plan_id, ResponsePlan.user_id == current_user.id,
    ))).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")
    approvals = (await db.execute(select(ApprovalRequest).where(
        ApprovalRequest.plan_id == plan_id).order_by(ApprovalRequest.id))).scalars().all()
    return {"plan": ResponsePlanResponse.model_validate(plan),
            "approval_count": len(approvals),
            "approval_status_counts": {state: sum(row.status == state for row in approvals)
                                       for state in sorted({row.status for row in approvals})},
            "deletion_fingerprint": deletion_fingerprint(plan, approvals)}


@router.post("/{plan_id}/delete-reviewed")
async def delete_reviewed_response_plan(
    plan_id: int, payload: ReviewedPlanDeletion,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    plan = (await db.execute(select(ResponsePlan).where(
        ResponsePlan.id == plan_id, ResponsePlan.user_id == current_user.id,
    ).with_for_update())).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")
    if plan.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Only draft or rejected plans can be deleted")
    approvals = (await db.execute(select(ApprovalRequest).where(
        ApprovalRequest.plan_id == plan_id).order_by(ApprovalRequest.id).with_for_update())).scalars().all()
    if not secrets.compare_digest(payload.reviewed_fingerprint, deletion_fingerprint(plan, approvals)):
        raise HTTPException(status_code=409, detail=(
            "The plan or approval history changed. Load a fresh deletion review."))
    await db.execute(delete(ApprovalRequest).where(ApprovalRequest.plan_id == plan_id))
    await db.execute(delete(ResponsePlan).where(ResponsePlan.id == plan_id))
    add_audit_log(db, user_id=current_user.id, action="response_plan_deleted", target_type="response_plan",
                  target_id=plan_id, detail=(f"Reviewed removal; investigation {plan.case_id}; "
                  f"{len(approvals)} approval rows removed; fingerprint {payload.reviewed_fingerprint}"))
    await db.commit()
    return {"success": True, "plan_id": plan_id, "case_id": plan.case_id,
            "deleted": True, "approvals_deleted": len(approvals)}


@router.delete("/{plan_id}")
async def delete_response_plan(
    plan_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a draft or rejected response plan and its approval requests."""
    plan = (await db.execute(
        select(ResponsePlan).where(
            ResponsePlan.id == plan_id,
            ResponsePlan.user_id == current_user.id,
        ).with_for_update()
    )).scalar_one_or_none()

    if not plan:
        raise HTTPException(status_code=404, detail="Response plan not found")

    if plan.status not in ("draft", "rejected"):
        raise HTTPException(
            status_code=400,
            detail=f"Only draft or rejected plans can be deleted (current: '{plan.status}')",
        )

    await db.execute(
        delete(ApprovalRequest).where(ApprovalRequest.plan_id == plan_id)
    )
    await db.execute(
        delete(ResponsePlan).where(ResponsePlan.id == plan_id)
    )
    await db.commit()

    return {"success": True, "message": f"Plan {plan_id} deleted"}


@router.get("/{plan_id}/decision-evidence")
async def get_response_decision_evidence(
    plan_id: int,
    page: int = Query(1, ge=1, le=1000000),
    size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read the current plan and recorded approval rows without making a decision."""
    plan = (await db.execute(select(ResponsePlan).where(
        ResponsePlan.id == plan_id, ResponsePlan.user_id == current_user.id,
    ))).scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Response plan not found")
    total = (await db.execute(select(func.count(ApprovalRequest.id)).where(
        ApprovalRequest.plan_id == plan_id,
    ))).scalar_one()
    approvals = (await db.execute(select(ApprovalRequest).where(ApprovalRequest.plan_id == plan_id)
                                 .order_by(ApprovalRequest.created_at.desc(), ApprovalRequest.id.desc())
                                 .offset((page - 1) * size).limit(size))).scalars().all()
    return {
        "schema_version": 1,
        "scope": "Current saved plan and one page of recorded approval-request rows. These are mutable records, "
                 "not an immutable decision log or proof that an action ran. "
                 "Missing results do not establish execution. "
                 "No approval, rejection or execution is performed by this read.",
        "retrieved_at": datetime.now(UTC),
        "plan": ResponsePlanResponse.model_validate(plan),
        "approval_page": page, "approval_size": size, "approval_total": total,
        "approval_records": [{
            "id": row.id, "plan_id": row.plan_id, "requested_by": row.requested_by,
            "status": row.status, "reason": row.reason, "reviewed_by": row.reviewed_by,
            "reviewed_at": row.reviewed_at, "created_at": row.created_at,
        } for row in approvals],
    }


@router.post('/draft-from-case/{case_id}')
async def create_response_draft(
    case_id: int, current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Generate an unapproved L1 proposal for a caller-owned case, never execute it."""
    from backend.models.case import Case
    from backend.services.agents.response import ResponseAgent
    case = (await db.execute(select(Case).where(
        Case.id == case_id, Case.user_id == current_user.id,
    ).with_for_update())).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    agent = ResponseAgent(db, current_user.id)
    try:
        result = await agent.execute(case_id=case.id, autonomy_level='L1', draft_only=True)
    except Exception:
        raise HTTPException(status_code=502, detail=(
            'Response draft generation did not complete. Check the investigation plan list and recorded runs '
            'before trying again. No approval or simulation was requested.')) from None
    return {'plan_id': result['plan_id'], 'case_id': case_id, 'status': result['status'],
            'autonomy_level': 'L1', 'run_id': agent._run.id, 'action_count': len(result['actions']),
            'approved': False, 'execution_requested': False}
