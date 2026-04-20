"""
Billing router for subscription management and Stripe integration.

Provides endpoints for plan listing, subscription management,
Stripe checkout session creation, webhook handling, and usage tracking.
"""

import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List

from backend.database.db import get_async_db
from backend.models.subscription import (
    Subscription,
    SubscriptionResponse,
    PlanInfo,
    CheckoutRequest,
    PLAN_LIMITS,
)
from backend.models.user import User
from backend.models.asset import Asset
from backend.models.organization import Organization
from backend.routers.auth import get_current_user
from backend.services.billing_service import (
    get_plan_info,
    PLAN_PRICES,
    STRIPE_PRICE_IDS,
)

logger = logging.getLogger(__name__)

router = APIRouter()

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


@router.get("/plans", response_model=List[PlanInfo])
async def list_plans():
    """List all available plans with pricing and limits."""
    plans = []
    for plan_name in ["free", "starter", "pro", "enterprise"]:
        info = get_plan_info(plan_name)
        if info:
            plans.append(info)
    return plans


@router.get("/subscription")
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get the current organization's subscription."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    result = await db.execute(
        select(Subscription).where(Subscription.org_id == current_user.org_id)
    )
    subscription = result.scalar_one_or_none()

    if subscription is None:
        # Return a default free subscription representation
        return {
            "success": True,
            "data": {
                "org_id": current_user.org_id,
                "plan": "free",
                "status": "active",
                "stripe_subscription_id": None,
                "current_period_start": None,
                "current_period_end": None,
                "cancel_at_period_end": False,
            },
            "error": None,
            "metadata": {},
        }

    return {
        "success": True,
        "data": {
            "id": subscription.id,
            "org_id": subscription.org_id,
            "plan": subscription.plan,
            "status": subscription.status,
            "stripe_subscription_id": subscription.stripe_subscription_id,
            "current_period_start": str(subscription.current_period_start) if subscription.current_period_start else None,
            "current_period_end": str(subscription.current_period_end) if subscription.current_period_end else None,
            "cancel_at_period_end": subscription.cancel_at_period_end,
        },
        "error": None,
        "metadata": {},
    }


@router.post("/checkout")
async def create_checkout_session(
    checkout_req: CheckoutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a Stripe checkout session for plan upgrade."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    if checkout_req.plan not in ["starter", "pro", "enterprise"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid plan. Must be one of: starter, pro, enterprise",
        )

    # If Stripe is not configured, return a mock response
    if not STRIPE_SECRET_KEY:
        return {
            "success": True,
            "data": {
                "checkout_url": None,
                "message": "Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.",
                "plan": checkout_req.plan,
                "price": PLAN_PRICES.get(checkout_req.plan, 0),
            },
            "error": None,
            "metadata": {},
        }

    # In production, this would create a real Stripe checkout session
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY

        # Get or create Stripe customer
        result = await db.execute(
            select(Subscription).where(Subscription.org_id == current_user.org_id)
        )
        subscription = result.scalar_one_or_none()

        customer_id = subscription.stripe_customer_id if subscription else None

        if not customer_id:
            customer = stripe.Customer.create(
                email=current_user.email,
                metadata={"org_id": str(current_user.org_id)},
            )
            customer_id = customer.id

        price_id = STRIPE_PRICE_IDS.get(checkout_req.plan)
        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            mode="subscription",
            success_url=checkout_req.success_url,
            cancel_url=checkout_req.cancel_url,
            metadata={"org_id": str(current_user.org_id), "plan": checkout_req.plan},
        )

        return {
            "success": True,
            "data": {"checkout_url": session.url},
            "error": None,
            "metadata": {},
        }
    except ImportError:
        return {
            "success": True,
            "data": {
                "checkout_url": None,
                "message": "Stripe SDK not installed.",
                "plan": checkout_req.plan,
                "price": PLAN_PRICES.get(checkout_req.plan, 0),
            },
            "error": None,
            "metadata": {},
        }
    except Exception as e:
        logger.error(f"Stripe checkout error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create checkout session",
        )


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
):
    """Handle Stripe webhook events."""
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe webhook secret not configured",
        )

    try:
        import stripe
        payload = await request.body()
        sig_header = request.headers.get("stripe-signature", "")

        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe SDK not installed",
        )
    except Exception as e:
        logger.error(f"Webhook signature verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook signature",
        )

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "customer.subscription.created":
        await _handle_subscription_created(data, db)
    elif event_type == "customer.subscription.updated":
        await _handle_subscription_updated(data, db)
    elif event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(data, db)
    elif event_type == "invoice.payment_failed":
        await _handle_payment_failed(data, db)

    return {"success": True, "data": {"received": True}, "error": None, "metadata": {}}


@router.post("/cancel")
async def cancel_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Cancel subscription at the end of the current billing period."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    result = await db.execute(
        select(Subscription).where(Subscription.org_id == current_user.org_id)
    )
    subscription = result.scalar_one_or_none()

    if subscription is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active subscription found",
        )

    if subscription.status == "canceled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subscription is already canceled",
        )

    subscription.cancel_at_period_end = True
    db.add(subscription)
    await db.commit()
    await db.refresh(subscription)

    return {
        "success": True,
        "data": {
            "message": "Subscription will be canceled at the end of the billing period",
            "cancel_at_period_end": True,
        },
        "error": None,
        "metadata": {},
    }


@router.get("/usage")
async def get_usage(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get current usage vs plan limits for the organization."""
    if current_user.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not belong to an organization",
        )

    # Get org's current plan
    result = await db.execute(
        select(Organization).where(Organization.id == current_user.org_id)
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    plan = org.plan or "free"
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

    # Count assets (assets belong to users, users belong to orgs)
    asset_count_result = await db.execute(
        select(func.count(Asset.id)).where(
            Asset.user_id.in_(
                select(User.id).where(User.org_id == current_user.org_id)
            )
        )
    )
    asset_count = asset_count_result.scalar() or 0

    # Count users
    user_count_result = await db.execute(
        select(func.count(User.id)).where(User.org_id == current_user.org_id)
    )
    user_count = user_count_result.scalar() or 0

    return {
        "success": True,
        "data": {
            "plan": plan,
            "assets": {"current": asset_count, "limit": limits["max_assets"]},
            "users": {"current": user_count, "limit": limits["max_users"]},
            "features": limits["features"],
        },
        "error": None,
        "metadata": {},
    }


# ---------------------------------------------------------------------------
# Webhook helpers
# ---------------------------------------------------------------------------

async def _handle_subscription_created(data: dict, db: AsyncSession):
    """Handle customer.subscription.created event."""
    org_id = data.get("metadata", {}).get("org_id")
    if not org_id:
        logger.warning("Subscription created event missing org_id in metadata")
        return

    result = await db.execute(
        select(Subscription).where(Subscription.org_id == int(org_id))
    )
    subscription = result.scalar_one_or_none()

    if subscription is None:
        subscription = Subscription(org_id=int(org_id))

    subscription.stripe_subscription_id = data.get("id")
    subscription.stripe_customer_id = data.get("customer")
    subscription.plan = data.get("metadata", {}).get("plan", "starter")
    subscription.status = data.get("status", "active")

    db.add(subscription)
    await db.commit()


async def _handle_subscription_updated(data: dict, db: AsyncSession):
    """Handle customer.subscription.updated event."""
    stripe_sub_id = data.get("id")
    result = await db.execute(
        select(Subscription).where(
            Subscription.stripe_subscription_id == stripe_sub_id
        )
    )
    subscription = result.scalar_one_or_none()

    if subscription is None:
        logger.warning(f"Subscription {stripe_sub_id} not found for update")
        return

    subscription.status = data.get("status", subscription.status)
    subscription.cancel_at_period_end = data.get(
        "cancel_at_period_end", subscription.cancel_at_period_end
    )

    db.add(subscription)
    await db.commit()


async def _handle_subscription_deleted(data: dict, db: AsyncSession):
    """Handle customer.subscription.deleted event."""
    stripe_sub_id = data.get("id")
    result = await db.execute(
        select(Subscription).where(
            Subscription.stripe_subscription_id == stripe_sub_id
        )
    )
    subscription = result.scalar_one_or_none()

    if subscription is None:
        logger.warning(f"Subscription {stripe_sub_id} not found for deletion")
        return

    subscription.status = "canceled"
    db.add(subscription)
    await db.commit()


async def _handle_payment_failed(data: dict, db: AsyncSession):
    """Handle invoice.payment_failed event."""
    stripe_sub_id = data.get("subscription")
    if not stripe_sub_id:
        return

    result = await db.execute(
        select(Subscription).where(
            Subscription.stripe_subscription_id == stripe_sub_id
        )
    )
    subscription = result.scalar_one_or_none()

    if subscription is None:
        logger.warning(f"Subscription {stripe_sub_id} not found for payment failure")
        return

    subscription.status = "past_due"
    db.add(subscription)
    await db.commit()
