"""
Organizations router for multi-tenancy management.

Provides endpoints for creating, viewing, updating organizations and
managing organization membership (inviting users, listing members).
"""


from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.organization import (
    Organization,
    OrgCreate,
    OrgOnCallResponse,
    OrgOnCallUpdate,
    OrgResponse,
    OrgUpdate,
)
from backend.models.user import User, UserResponse
from backend.routers.auth import get_current_user
from backend.services.oncall import current_on_call_id

router = APIRouter()

@router.post("/", response_model=OrgResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    org_data: OrgCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new organization and assign the creator as admin."""
    # Check if user already belongs to an organization
    if current_user.org_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already belongs to an organization",
        )

    # Check for duplicate slug
    result = await db.execute(
        select(Organization).where(Organization.slug == org_data.slug)
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization slug already taken",
        )

    # Create organization
    org = Organization(
        name=org_data.name,
        slug=org_data.slug,
        plan="free",
    )
    db.add(org)
    await db.flush()  # Get org.id before assigning to user

    # Assign creator to org and promote to admin
    current_user.org_id = org.id
    current_user.role = "admin"
    db.add(current_user)

    await db.commit()
    await db.refresh(org)
    return org


@router.get("/me", response_model=OrgResponse)
async def get_my_organization(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get the current user's organization."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    result = await db.execute(
        select(Organization).where(Organization.id == current_user.org_id)
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    return org


@router.patch("/me", response_model=OrgResponse)
async def update_my_organization(
    org_update: OrgUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update the current user's organization (admin only)."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization admins can update organization settings",
        )

    result = await db.execute(
        select(Organization).where(Organization.id == current_user.org_id)
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # Apply updates
    update_data = org_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(org, field, value)

    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


@router.get("/me/on-call", response_model=OrgOnCallResponse)
async def get_on_call_rotation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """The org's on-call rotation and who is on call right now."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )
    org = await db.get(Organization, current_user.org_id)
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    return OrgOnCallResponse(
        member_ids=list(org.on_call_member_ids or []),
        anchor_date=org.on_call_anchor_date,
        current_member_id=await current_on_call_id(db, org),
    )


@router.patch("/me/on-call", response_model=OrgOnCallResponse)
async def set_on_call_rotation(
    payload: OrgOnCallUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Set the on-call rotation order (admin only). Empty list disables it."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization admins can update organization settings",
        )
    org = await db.get(Organization, current_user.org_id)
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    # Dedupe, preserving order.
    member_ids = list(dict.fromkeys(payload.member_ids))
    if member_ids:
        active = (await db.execute(
            select(User.id).where(
                User.id.in_(member_ids),
                User.org_id == org.id,
                User.is_active == True,  # noqa: E712
            )
        )).scalars().all()
        if sorted(active) != sorted(member_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Rotation members must be active members of your organization",
            )
    org.on_call_member_ids = member_ids or None
    org.on_call_anchor_date = datetime.now(UTC).date() if member_ids else None
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return OrgOnCallResponse(
        member_ids=list(org.on_call_member_ids or []),
        anchor_date=org.on_call_anchor_date,
        current_member_id=await current_on_call_id(db, org),
    )


@router.post("/me/invite", status_code=status.HTTP_200_OK)
async def invite_user_to_org(
    email: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Invite a user to the current organization by email (admin only)."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization admins can invite users",
        )

    # Check member limit
    result = await db.execute(
        select(Organization).where(Organization.id == current_user.org_id)
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    member_count_result = await db.execute(
        select(User).where(User.org_id == org.id)
    )
    member_count = len(member_count_result.scalars().all())
    if member_count >= org.max_users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization has reached the maximum number of users ({org.max_users})",
        )

    # Find the user to invite
    result = await db.execute(select(User).where(User.email == email))
    invitee = result.scalar_one_or_none()
    if invitee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if invitee.org_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already belongs to an organization",
        )

    # Add user to organization
    invitee.org_id = org.id
    db.add(invitee)
    await db.commit()

    return {
        "success": True,
        "data": {"message": f"User {email} added to organization {org.name}"},
        "error": None,
        "metadata": {},
    }


@router.delete("/me/members/{user_id}", status_code=status.HTTP_200_OK)
async def remove_org_member(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Remove a member from the current organization (admin only).

    The member keeps their account but leaves the org. An admin cannot
    remove themselves, and the last remaining admin cannot be removed.
    """
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization admins can remove members",
        )

    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admins cannot remove themselves from the organization",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    member = result.scalar_one_or_none()
    if member is None or member.org_id != current_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found in this organization",
        )

    if member.role == "admin":
        admin_count = (await db.execute(
            select(func.count()).select_from(User).where(
                User.org_id == current_user.org_id,
                User.role == "admin",
            )
        )).scalar_one()
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The last remaining admin cannot be removed",
            )

    member.org_id = None
    db.add(member)
    await db.commit()

    return {
        "success": True,
        "data": {"message": f"User {member.email} removed from the organization"},
        "error": None,
        "metadata": {},
    }


@router.get("/me/members", response_model=list[UserResponse])
async def list_org_members(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all members of the current user's organization."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    result = await db.execute(
        select(User).where(User.org_id == current_user.org_id)
    )
    members = result.scalars().all()
    return members
